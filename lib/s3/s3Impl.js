/*******************************************************************************
 * @license
 * Copyright (c) 2012 IBM Corporation and others.
 * All rights reserved. This program and the accompanying materials are made 
 * available under the terms of the Eclipse Distribution License v1.0 
 * (http://www.eclipse.org/org/documents/edl-v10.html).
 * 
 * Contributors: IBM Corporation - initial API and implementation
 ******************************************************************************/
/*global alert Crypto define DOMParser localStorage prompt sessionStorage XMLSerializer*/
/*jslint browser:true sub:true*/
define(['dojo/_base/Deferred', 's3/crypto'], function(Deferred) {
	var DELIM = '/';
//	var utf8encode = Crypto.charenc.UTF8.stringToBytes;

	var Auth = (function() {
		function getStringToSign(method, url, headers, body) {
			var NL = String.fromCharCode(0x0A);
			function getDate() {
				var date = headers['Date'], amzDate = headers['x-amz-date'];
				if (amzDate || !date) {
					return ''; // Use 'x-amz-date' instead of Date header, leave date part blank
				}
				return date;
			}
			function getCanonicalizedResource() {
				var a = document.createElement('a');
				a.href = url;
				var path = a.pathname;
				var hostname = a.hostname;
				var query = a.search;
				var result = '';
				// If the host specifies a bucket, include it in the resource
				if (hostname !== 's3.amazonaws.com') {
					var bucket;
					var sub = '.s3.amazonaws.com';
					if (hostname.indexOf(sub) === hostname.length - sub.length) {
						bucket = hostname.substr(0, hostname.indexOf(sub));
					} else {
						bucket = hostname.toLowerCase();
					}
					result += '/' + bucket;
				}
				result += path;
				// Append delete param if present (multi-object delete)
				// TODO: include sub-resource params, and params that override header values.
				var params = query.split(/[?&]/);
				for (var i=0; i < params.length; i++) {
					if (params[i] === "delete") {
						result += '?delete';
						break;
					}
				}
				return result;
			}
			function getCanonicalizedAmzHeaders() {
				var amzHeaders = [];
				for (var header in headers) {
					if (Object.prototype.hasOwnProperty.call(headers, header)) {
						var value = headers[header], headerLc = header.toLowerCase();
						if (headerLc.indexOf('x-amz-') === 0) {
							amzHeaders.push(headerLc + ':' + value + NL);
						}
					}
				}
				amzHeaders.sort(function(h1, h2) {
					if (h1 < h2) { return -1; }
					else if (h2 > h1) { return 1; }
					return 0;
				});
				return amzHeaders.join('');
			}
			var contentMD5 = headers['Content-MD5'] || '';
			var contentType = headers['Content-Type'] || '';
			var date = getDate();
			var stringToSign = method + NL +
				contentMD5 + NL +
				contentType + NL +
				date + NL +
				getCanonicalizedAmzHeaders() +
				getCanonicalizedResource();
			return stringToSign;
		}
		function getContentMD5(content) {
			return Crypto.util.bytesToBase64(Crypto.MD5(content, {asBytes: true}));
		}
		/**
		 * @param {String} method
		 * @param {Object} headers
		 * @param {Object} body
		 * @param {Function} keyGetter Function to provide the keys. Takes no arguments and returns an Array of 2 Strings.
		 * The first element being the Access Key and the second element is the Secret Access Key.
		 */
		function getAuth(method, url, headers, body, keyGetter) {
			var keys = keyGetter();
			var awsAccessKeyId = keys[0], awsSecretAccessKeyId = keys[1];
			var stringToSign = Auth.getStringToSign(method, url, headers, body);
			// TODO: am I supposed to convert the 2 strings to utf-8 here
			var signature = Crypto.util.bytesToBase64(Crypto.HMAC(Crypto.SHA1, stringToSign, awsSecretAccessKeyId, { asBytes: true }));
			return 'AWS' + ' ' + awsAccessKeyId + ':' + signature;
		}
		return {
			getAuth: getAuth,
			getContentMD5: getContentMD5,
			getStringToSign: getStringToSign
		};
	}());

	var Parse = (function() {
		function serializeChildren(elem) {
			var children = elem.childNodes;
			if (children.length === 0) {
				return null;
			}
			if (children.length === 1 && children[0].nodeType === 3) {
				return children[0].nodeValue;
			}
			var result = "";
			var serializer = new XMLSerializer();
			for (var i = 0; i < children.length; i++) {
				result += serializer.serializeToString(children[i]);
			}
			return result;
		}
		function toArray(/**NodeList*/ elements, nsURI) {
			var result = [];
			for (var i=0; i < elements.length; i++) {
				var element = elements[i], children = element.childNodes;
				var obj = {};
				for (var j=0; j < children.length; j++) {
					var current = children[j];
					if (current.nodeType === 1) {
						if (current.namespaceURI === nsURI) {
							obj[current.localName] = serializeChildren(current);
						}
					}
				}
				result.push(obj);
			}
			return result;
		}
		function parseBucket(text) {
			var dom = new DOMParser().parseFromString(text, 'text/xml');
			var listBucketElement = dom.childNodes[0];
			var awsNamespace = listBucketElement.namespaceURI;
			var prefixElement = listBucketElement.getElementsByTagNameNS(awsNamespace, 'Prefix')[0];
			var contentsElements = listBucketElement.getElementsByTagNameNS(awsNamespace, 'Contents');
			var commonPrefixesElements = listBucketElement.getElementsByTagNameNS(awsNamespace, 'CommonPrefixes');
			var prefix = (prefixElement && serializeChildren(prefixElement)) || "";
			return {
				CommonPrefixes: toArray(commonPrefixesElements, awsNamespace),
				Contents: toArray(contentsElements, awsNamespace),
				Prefix: prefix
			};
		}
		function parseMultiDeleteResponse(text) {
			var dom = new DOMParser().parseFromString(text, 'text/xml');
			var root = dom.childNodes[0];
			var awsNamespace = root.namespaceURI;
			var errorElements = root.getElementsByTagNameNS(awsNamespace, 'Element');
			return {
				Error: toArray(errorElements, awsNamespace)
			};
		}
		return {
			parseBucket: parseBucket,
			parseMultiDeleteResponse: parseMultiDeleteResponse
		};
	}());

	/**
	 * Prompts for any of: the user's passphrase, AWS Access Key and Secret Key. The keys are encryped
	 * using the passphrase and the encryped keys are persisted in <code>localStorage</code>. The passphrase
	 * is kept in <code>sessionStorage</code>, so must be re-entered whenever the window is reopened.
	 */
	function promptForKeys() {
		var prefix = 's3plugin_' + location;
		function CryptError(msg) {
			this.msg = msg;
		}
		function assert(what, msg) {
			if (!what) {
				alert(msg);
				throw msg;
			}
		}
		function encrypt(message, passphrase) {
			return Crypto.AES.encrypt(message, passphrase);
		}
		function decrypt(crypted, passphrase) {
			return Crypto.AES.decrypt(crypted, passphrase);
		}
		function getItem(store, key) {
			return store.getItem(prefix + key);
		}
		function getCryptedItem(store, key, passphrase) {
			var crypted = store.getItem(prefix + key);
			if (typeof crypted === 'string') {
				var result;
				try {
					result = decrypt(crypted, passphrase);
				} catch (e) {
					throw new CryptError('Wrong passphrase.');
				}
				return result;
			}
			return null;
		}
		function setItem(store, key, value) {
			return store.setItem(prefix + key, value);
		}
		function removeItem(store, key) {
			return store.removeItem(prefix + key);
		}
		function promptFor(msg) {
			var result = prompt(msg);
			return result && result.trim();
		}
		var passphrase = getItem(sessionStorage, 'passphrase') || promptFor('Enter your passphrase:');
		assert(passphrase, 'Passphrase not provided.');
		assert(passphrase.length > 5, 'Passphrase too short.');
		setItem(sessionStorage, 'passphrase', passphrase);
		try {
			var access = getCryptedItem(localStorage, 'accessKey', passphrase) || promptFor('Enter your "Access Key Id":\n(will be encrypted and saved in localStorage)');
			assert(access, 'Access Key Id not provided.');
			setItem(localStorage, 'accessKey', encrypt(access, passphrase));

			var secret = getCryptedItem(localStorage, 'secretKey', passphrase) || promptFor('Enter your "Secret Access Key":\n(will be encrypted and saved in localStorage)');
			assert(secret, 'Secret Access Key not provided.');
			setItem(localStorage, 'secretKey', encrypt(secret, passphrase));

			return [access, secret];
		} catch (e) {
			if (e instanceof CryptError) {
				removeItem(sessionStorage, 'passphrase');
				alert(e.msg);
				throw e;
			}
		}
	}

	/**
	 * @param {String} prefix
	 * @param {String} [delimiter=DELIM] If omitted, defaults to DELIM. Pass <code>null</code> for no delimiter.
	 */
	function makeQuery(prefix, delimiter) {
		if (typeof delimiter === 'undefined') {
			return '?delimiter=' + encodeURIComponent(DELIM) + '&prefix=' + encodeURIComponent(prefix);
		} else if (delimiter === null) {
			return '?prefix=' + encodeURIComponent(prefix);
		}
	}

	/**
	 * @param {String} rootLocation
	 * @param {String} prefix
	 * @param {Object} props
	 */
	function createFile(rootLocation, prefix, props) {
		function stripPrefix(key) {
			var index = key.indexOf(prefix);
			return index !== -1 ? key.substr(index + prefix.length) : key;
		}
		var result = {
			Attributes: {
					Archive: false, 
					Hidden: false,
					ReadOnly: false,
					SymLink: false
			}};
		if (!props.Key) {
			throw 'Key is required';
		}
		var host = rootLocation;
		var isDirectory = (props.Key[props.Key.length - 1] === DELIM);
		if (isDirectory) {
			// To get "directory" contents, we GET top of bucket with the prefix being the directory
			result.ChildrenLocation = host + '/' + makeQuery(props.Key);
		}
		result.Location = host + '/' + props.Key;
		result.Name = stripPrefix(props.Key);
		if (isDirectory) {
			result.Name = result.Name.substring(0, result.Name.length - 1);
		}
		if (props.ETag) {
			result.ETag = props.ETag;
		}
		if (props.Size) {
			result.Length = Number(props.Size);
		}
		if (props.LastModified) {
			result.LocalTimeStamp = new Date(props.LastModified).getTime();
		}
		result.Directory = isDirectory;
		return result;
	}

	function _call(method, url, headers, body) {
		headers = headers || {};
		var d = new Deferred(); // create a promise
		var xhr = new XMLHttpRequest();
		var header;
		try {
			xhr.open(method, url);
			if (headers) {
				var date = new Date().toUTCString();
				// We can't set 'Date' so use 'x-amz-date' instead.
				headers['x-amz-date'] = date;
				headers['Authorization'] = Auth.getAuth(method, url, headers, body, promptForKeys);
				for (header in headers) {
					if (headers.hasOwnProperty(header)) {
						xhr.setRequestHeader(header, headers[header]);
					}
				}
			}
			xhr.send(body);
			xhr.onreadystatechange = function() {
				if (xhr.readyState === 4) {
					d.resolve({
						status: xhr.status,
						statusText: xhr.statusText,
						headers: xhr.getAllResponseHeaders(),
						responseText: xhr.responseText
					});
				}
			};
		} catch (e) {
			d.reject(e);
		}
		return d; // return the promise immediately
	}

	/**
	 * @name orion.file.S3FileServiceImpl
	 * @class
	 * @see orion.fileClient.FileClient
	 * @borrows orion.fileClient.FileClient#fetchChildren as #fetchChildren
	 * @param {String} rootLocation The target bucket's URI, in the AWS path-style syntax.<br />Example: <code>"http://s3.amazonaws.com/mybucket"</code>
	 * @see http://docs.amazonwebservices.com/AmazonS3/latest/dev/VirtualHosting.html#VirtualHostingExamples
	 */
	function S3FileServiceImpl(rootLocation) {
		this._rootLocation = rootLocation;
	}
	S3FileServiceImpl.prototype = /**@lends orion.file.S3FileServiceImpl.prototype*/ {
		/**
		 * @param {String} resourceURL The resource URL of a directory, e.g. <code>http://s3.amazonaws.com/mamacdon/foo/bar/</code>
		 * @returns {String} The directory prefix, e.g. <code>foo/bar/</code>
		 */
		_directoryResourceToPrefix: function(resourceURL) {
			var tail = resourceURL.substring(resourceURL.indexOf(this._rootLocation) + this._rootLocation.length);
			return (tail[0] === DELIM) ? tail.substr(1): tail;
		},
		/**
		 * Parses a prefix (directory) from a query parameter.
		 * @param {String} location
		 * @returns {String} The prefix
		 */
		_getPrefix: function(location) {
			function parseParams(loc) {
				var queryIdx = loc.indexOf('?');
				if (queryIdx === -1) {
					return {};
				}
				var params = loc.substring(queryIdx).split(/[?&]/);
				var result = {};
				for (var i=0; i < params.length; i++) {
					var p = params[i];
					if (p) {
						var eqIdx = p.indexOf('='), name = p.substr(0, eqIdx), value = p.substr(eqIdx + 1);
						result[name] = value;
					}
				}
				return result;
			}
			var p = parseParams(location);
			return (typeof p.prefix === 'undefined') ? null : p.prefix;
		},
		_segments: function(location) {
			if (location.indexOf(this._rootLocation) === -1 || this._rootLocation === location) {
				return null;
			}
			var path = this._getPrefix(location);
			if (!path) {
				return null;
			}
			if (path[path.length - 1] === DELIM) {
				path = path.substring(0, path.length - 1);
			}
			return path.split(DELIM);
		},
		_createParents: function(location) {
			var result = [];
			var segments = this._segments(location);
			if (!segments) { return null; }
			segments.pop(); // pop off the current name

			var base = this._rootLocation, folderPath = '';
			for (var i = 0; i < segments.length; ++i) {
				var parentName = segments[i];
				folderPath = folderPath + parentName + DELIM;
				result.push({
					Name: parentName,
					Location: base + '/' + folderPath,
					ChildrenLocation: base + makeQuery(folderPath)
				});
			}
			return result.reverse();
		},
		fetchChildren: function(location) {
			if (!location) {
				location = this._rootLocation;
			}
			var that = this;
			return _call('GET', location).then(function(response) {
				if (response.status !== 200) {
					throw 'Error ' + response.status + ' ' + response.responseText;
				}
				var bucket = Parse.parseBucket(response.responseText);
				var bucketContents = bucket.Contents;
				var commonPrefixes = bucket.CommonPrefixes;
				var children = [];
				// Files
				for (var i=0; i < bucketContents.length; i++) {
					var contentsElement = bucketContents[i];
					var isThisFolder = bucket.Prefix && bucket.Prefix === contentsElement.Key;
					if (!isThisFolder) {
						children.push(createFile(that._rootLocation, bucket.Prefix,
							{	Key: contentsElement.Key,
								LastModified: contentsElement.LastModified,
								Size: contentsElement.Size
							}));
					}
				}
				// Directories
				for (i=0; i < commonPrefixes.length; i++) {
					var prefix = commonPrefixes[i];
					children.push(createFile(that._rootLocation, bucket.Prefix,
							{	Key: prefix.Prefix
							}));
				}
				return children;
			});
		},
		loadWorkspaces: function() {
			return this.loadWorkspace(this._rootLocation);
		},
		loadWorkspace: function(location) {
			if (!location || location === this._rootLocation) {
				// To get top-level children, do GET on the bucket with empty prefix
				location = this._rootLocation + '/' + makeQuery("");
			}
			var that = this;
			return this.fetchChildren(location).then(function(children) {
				var result = {};
				result.Location = location;
				var segments = that._segments(location);
				if (segments/* && segments.length > 1*/) {
					result.Name = segments.pop();
				} else {
					result.Name = that._rootLocation; // ??
				}
				result.Directory = true;
				result.ChildrenLocation = that._rootLocation + '/' + makeQuery(that._getPrefix(location) || "");
				result.Children = children;
				var parents = that._createParents(location);
				if (parents) {
					result.Parents = parents;
				}
				return result;
			});
		},
		createProject: function(url, projectName, serverPath, create) {
			return this.createFolder(url, projectName);
		},
		createFolder: function(parentLocation, folderName) {
			if (folderName.indexOf(DELIM) !== -1) {
				throw 'Folder names must not contain \'' + DELIM + '\'';
			}
			var prefix = this._getPrefix(parentLocation);
			var location;
			if (prefix !== null) {
				// parentLocation is a directory-list URL
				location = this._rootLocation + '/' + prefix + encodeURIComponent(folderName) + DELIM;
			} else {
				location = parentLocation + encodeURIComponent(folderName) + DELIM;
			}
			return _call('PUT', location);
		},
		createFile: function(parentLocation, fileName) {
			var prefix = this._getPrefix(parentLocation);
			var location;
			if (prefix !== null) {
				location = this._rootLocation + '/' + prefix + encodeURIComponent(fileName);
			} else {
				location = parentLocation + encodeURIComponent(fileName) + DELIM;
			}
			return _call('PUT', location);
		},
		deleteFile: function(location) {
			/** @returns {dojo.Promise} */
			function deleteObjects(deleteLocation, /**Array*/ keys) {
				var deleteBody = '' +
					'<Delete>' + 
					'<Quiet>true</Quiet>' +
					keys.map(function(key) {
						return '<Object><Key>' + key + '</Key></Object>';
					}).join('') + 
					'</Delete>';
				return _call('POST', deleteLocation, {
							'Content-MD5': Auth.getContentMD5(deleteBody),
							'Content-Type': 'applicaton/xml'
						}, deleteBody)
					.then(function(deleteResponse) {
						var d = new Deferred();
						var deleteResult = Parse.parseMultiDeleteResponse(deleteResponse.responseText);
						var errors = deleteResult.Error;
						if (errors.length) {
							var result = [];
							for (var i=0; i < errors.length; i++) {
								result.push(errors[i]);
							}
							d.errback(result);
						} else {
							d.callback();
						}
						return d;
					});
			}
			var isDirectory = location[location.length - 1] === DELIM;
			if (!isDirectory) {
				return _call('DELETE', location);
			} else {
				var prefix = this._directoryResourceToPrefix(location);
				if (prefix[prefix.length - 1] === DELIM) {
					prefix = prefix.substr(0, prefix.length - 1);
				}
				// To remove /foo/bar/ we collect all keys /foo/bar* then filter out irrelevant ones like
				// /foo/barfly.txt, then multidelete. Kind of hacky. Alternative is to collect the keys
				// with one GET for each subdirectory of /foo/bar (slower but safer/more correct)
				var that = this;
				var descendantsLocation = this._rootLocation + makeQuery(prefix, null);
				return _call('GET', descendantsLocation).then(function(getResponse) {
					var bucket = Parse.parseBucket(getResponse.responseText);
					var bucketContents = bucket.Contents;
					var keysToDelete = [];
					var prefixWithTrailingDelim = prefix + DELIM;
					for (var i=0; i < bucketContents.length; i++) {
						var key = bucketContents[i].Key;
						// Filter out stuff that we don't really want
						if (key.indexOf(prefixWithTrailingDelim) === 0) {
							keysToDelete.push(key);
						}
					}
					var deleteLocation = that._rootLocation + '?delete';
					return deleteObjects(deleteLocation, keysToDelete);
				});
			}
		},
		moveFile: function(sourceLocation, targetLocation, name) {
			// TODO I think S3 supports this
			throw 'Not supported: moveFile';
		},
		copyFile: function(sourceLocation, targetLocation, name) {
			// TODO implement this
			throw 'Not supported: copyFile';
		},
		read: function(location, isMetadata) {
			var that = this; 
			if (isMetadata) {
				return _call('HEAD', location).then(function(response) {
					if (response.status !== 200) {
						throw 'Error ' + response.status;
					}
					var name = location.substring(location.indexOf(that._rootLocation) + that._rootLocation.length);
					var result = createFile(that._rootLocation, null, {
							ETag: response.headers.ETag,
							LastModified: response.headers['Last-Modified'],
							Key: name,
							Size: response.headers['Content-Length']
						});
					var parents = that._createParents(location);
					if (parents !== null) {
						result.Parents = parents;
					}
					return result;
				});
			}
			return _call('GET', location).then(function(response) {
				return response.responseText;
			});
		},
		write: function(location, contents, args) {
			var headers = {'Content-Type': 'text/plain;charset=UTF-8'};
			// S3 does not allow If-Match here
			// TODO: Perhaps we should include Content-MD5 for reliability
			return _call('PUT', location, headers, contents);
		},
		remoteImport: function(targetLocation, options) {
			// TODO implement this
			throw 'Not supported: remoteImport';
		},
		remoteExport: function(sourceLocation, options) {
			throw 'Not supported: remoteExport';
		}
	};

	return {
		S3FileServiceImpl: S3FileServiceImpl,
		getStringToSign: Auth.getStringToSign,
		getAuth: Auth.getAuth
	};
});
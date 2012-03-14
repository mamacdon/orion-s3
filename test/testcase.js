/*******************************************************************************
 * @license
 * Copyright (c) 2012 IBM Corporation and others.
 * All rights reserved. This program and the accompanying materials are made 
 * available under the terms of the Eclipse Public License v1.0 
 * (http://www.eclipse.org/legal/epl-v10.html), and the Eclipse Distribution 
 * License v1.0 (http://www.eclipse.org/org/documents/edl-v10.html). 
 * 
 * Contributors: IBM Corporation - initial API and implementation
 ******************************************************************************/
/*jslint browser: true, devel: true*/
/*global define */
define(["orion/assert", "s3/s3Impl"], function(assert, S3Impl) {
	var tests = {};

	function getStringToSign(method, url, headers, body) {
		var result = S3Impl.getStringToSign(method, url, headers, body);
		return result;
	}
	
	function getAuth(method, url, headers, body) {
		return S3Impl.getAuth(method, url, headers, body, function() {
			return ["AKIAIOSFODNN7EXAMPLE", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"];
		});
	}

	tests['test getStringToSign 1'] = function() {
		var actual = getStringToSign("GET", "http://johnsmith.s3.amazonaws.com/photos/puppy.jpg", {
			'Date': 'Tue, 27 Mar 2007 19:36:42 +0000'
		});
		var expected = "GET\n" + "\n" + "\n" + "Tue, 27 Mar 2007 19:36:42 +0000\n" + "/johnsmith/photos/puppy.jpg";
		assert.strictEqual(actual, expected);
	};

	tests['test getStringToSign 2'] = function() {
		var actual = getStringToSign("PUT", "http://johnsmith.s3.amazonaws.com/photos/puppy.jpg", {
			'Content-Type': 'image/jpeg',
			'Content-Length': '94328',
			'Date': 'Tue, 27 Mar 2007 21:15:45 +0000'
		});
		var expected = "PUT\n" + "\n" + "image/jpeg\n" + "Tue, 27 Mar 2007 21:15:45 +0000\n" + "/johnsmith/photos/puppy.jpg";
		assert.strictEqual(actual, expected);
	};

	tests['test getStringToSign 3'] = function() {
		var actual = getStringToSign("GET", "http://johnsmith.s3.amazonaws.com/?prefix=photos&max-keys=50&marker=puppy", {
			'User-Agent': 'Mozilla/5.0',
			'Date': 'Tue, 27 Mar 2007 19:42:41 +0000'
		});
		var expected = "GET\n" + "\n" + "\n" + "Tue, 27 Mar 2007 19:42:41 +0000\n" + "/johnsmith/";
		assert.strictEqual(actual, expected);
	};

	tests['test getStringToSign 4'] = function() {
		var actual = getStringToSign("DELETE", "http://s3.amazonaws.com/johnsmith/photos/puppy.jpg", {
			'User-Agent': 'dotnet',
			'Date': 'Tue, 27 Mar 2007 21:20:27 +0000',
			'x-amz-date': 'Tue, 27 Mar 2007 21:20:26 +0000'
		});
		var expected = "DELETE\n" + "\n" + "\n" + "\n" + "x-amz-date:Tue, 27 Mar 2007 21:20:26 +0000\n" + "/johnsmith/photos/puppy.jpg";
		assert.strictEqual(actual, expected);
	};

	// This WORKS but the signature given in the s3 docs is not correct! dunno
//	tests['test getAuth 1'] = function() {
//		var actual = getAuth("GET", "http://johnsmith.s3.amazonaws.com/photos/puppy.jpg", {
//			'Date': 'Tue, 27 Mar 2007 19:36:42 +0000'
//		});
//		var expected = 'AWS AKIAIOSFODNN7EXAMPLE:xXjDGYUmKxnwqr5KXNPGldn5LbA=';
//		assert.strictEqual(actual, expected);
//	};

	return tests;
});

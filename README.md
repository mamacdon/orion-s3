Orion-S3 is a plugin for [Eclipse Orion](http://wiki.eclipse.org/Orion) that provides access
to an Amazon S3 bucket as a filesystem.

Details
-------
The plugin should be hosted from an S3 bucket that is configured as a website. The plugin makes REST requests 
(to read and write files) against a second bucket. You must have the appropriate credentials to access both buckets.

Security
--------
The plugin prompts for your AWS **Access Key** and **Secret Access Key**. These are used to sign requests
to the AWS API. The Secret Access Key is *not* transmitted over the wire, but it is stored in your browser's 
[localStorage](https://developer.mozilla.org/en/DOM/Storage#localStorage).

Please consider the security implications of using this plugin, and examine its source code to your satisfaction
before using. Never type or paste your secret key into a web page that you do not control. Never install a plugin
from an untrusted source.

Installation
------------
1. Checkout the source from Github.
2. Edit the source code of ```s3FilePlugin.html```. Set ```targetBucket``` to the URL of the bucket that will hold your Orion files.
   The URL must be given using the AWS [path-style syntax](http://docs.amazonwebservices.com/AmazonS3/latest/dev/VirtualHosting.html#d0e4464),
   so the host is **s3.amazonaws.com** and the bucket name is the path component of the URL.
   For example: http://s3.amazonaws.com/myorionfiles
3. Upload the modified plugin source code to a second S3 bucket that you control. The bucket must be configured to serve static web content.
   For configuration help, see [Hosting Websites on Amazon S3](http://docs.amazonwebservices.com/AmazonS3/latest/dev/WebsiteHosting.html?r=499).
   Ensure all the plugin files are publicly readable, or you'll get 403 errors later.
4. Load the plugin's URL to verify that it can be accessed.
   For example, if your website bucket is "mywebsite", the URL should look something like this:
       http://s3.amazonaws.com/mywebsite/s3FilePlugin.html
5. Log in to Orion and install the plugin using its URL.
6. The target bucket should appear as an additional filesystem in the Orion navigator. 
   Browse into it to view and edit files. The first time you try to access the bucket, you'll be prompted for your keys.
   The keys will be persisted in your browser's localStorage, which can usually be cleared using the browser's "Clear Private Data" feature.

Note that both ```targetBucket``` and the plugin URL use **s3.amazonaws.com** as the hostname. These hostnames must match exactly, so that
the plugin can make AWS API calls using XMLHttpRequest without violating the [same origin policy](https://developer.mozilla.org/En/Same_origin_policy_for_JavaScript).

Requirements
------------
* [Orion 0.4](http://download.eclipse.org/orion/)+

License
-------
[Eclipse Distribution License v 1.0](http://www.eclipse.org/org/documents/edl-v10.html).

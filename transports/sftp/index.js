const fs = require('fs');
const path = require('path');
const Client = require('ssh2-sftp-client');
const stream = require('stream');

module.exports = function (RED) {
    'use strict';

    let sftp = new Client();

    function SFtpNode(n) {
        RED.nodes.createNode(this, n);
        let node = this;

        let keyFile = null;
        let keyData = null;
        if (process.env.SFTP_SSH_KEY_FILE){
            keyFile = process.env.SFTP_SSH_KEY_FILE;
            keyFile = path.resolve(__dirname,'../../' + keyFile);
            console.log("SFTP_SSH_KEY_FILE: " + keyFile);

            try{
                keyData = fs.readFileSync(keyFile).toString();
            } catch (e){
                keyData = null;
                console.log("SFTP - Read Key File [" + keyFile + "] Exception : " + e);
            }
        }

        if (keyFile && keyData) {
            console.log("SFTP - Using privateKey: " + keyFile + " Length: " + keyData.toString().length);
            this.options = {
                host: n.host || 'localhost',
                port: n.port || 22,
                privateKey: keyData,
                ssh_dss: n.ssh_dss
            };
        } else {
            console.log("SFTP - Using User/Pwd");
            this.options = {
                host: n.host || 'localhost',
                port: n.port || 22,
                ssh_dss: n.ssh_dss
            };
        }
    }

    RED.nodes.registerType('sftp', SFtpNode, {
        credentials: {
            username: { type: "text" },
            password: { type: "password" }
        }
    });

    function SFtpInNode(n) {
        RED.nodes.createNode(this, n);
        this.sftp = n.sftp;
        this.operation = n.operation;
        this.filename = n.filename;
        this.localFilename = n.localFilename;
        this.workdir = n.workdir;
        this.sftpConfig = RED.nodes.getNode(this.sftp);

        // Validate config exists
        if (!this.sftpConfig) {
            this.error('No configuration found. Please validate configuration.');
            return;
        }

        // Validate credentials are present.
        if (!this.sftpConfig.credentials.username || !this.sftpConfig.credentials.password ||
            this.sftpConfig.credentials.username === '' || this.sftpConfig.credentials.password === '') {
            this.error('Invalid SFTP credentials. Make sure username and password are defined in server configuration.');
            return;
        }

        if (!this.sftpConfig) {
            this.error('missing sftp configuration');
            return;
        }

        let node = this;
        node.on('input', function (msg) {
            node.status({ fill:"blue",shape:"dot",text: 'connecting' });
            try {
                node.workdir = node.workdir || msg.workdir || "./";
                node.localFilename = node.localFilename || msg.localFilename || "";

                /*SFTP options*/
                node.sftpConfig.options.host = msg.host || node.sftpConfig.options.host ;
                node.sftpConfig.options.port = msg.port || node.sftpConfig.options.port ;
                node.sftpConfig.options.username = msg.user || node.sftpConfig.credentials.username || "";
                node.sftpConfig.options.password = msg.password || node.sftpConfig.credentials.password || "";
                node.sftpConfig.options.ssh_dss = msg.ssh_dss || node.sftpConfig.options.ssh_dss || { };

                let conSettings = {
                    host: node.sftpConfig.options.host,
                    port: node.sftpConfig.options.port,
                    username: node.sftpConfig.options.username,
                    password: node.sftpConfig.options.password,
                };
                if (node.sftpConfig.options.ssh_dss) {
                    conSettings.algorithms = {
                        serverHostKey: ['ssh-dss']
                    }
                }

                return new Promise(async function(resolve,reject) {
                    if (node.running) {
                        node.error('Node is already running');
                        return reject('Node is already running');
                    }
                    node.running = true;
                    try {
                        // Connect to sftp server
                        await sftp.connect(conSettings);
                        node.status({ fill: 'green', shape: 'dot', text: 'connected' });

                        switch (node.operation) {
                            case 'list':
                                let fileListing = await sftp.list(node.workdir);
                                msg.payload = fileListing;
                                node.send(msg);
                                break;
                            case 'get':
                                let getFtpFileName = path.join(node.workdir, node.filename);
                                if (msg.payload.filename) getFtpFileName = msg.payload.filename;

                                let fileBytes = await sftp.get(getFtpFileName);
                                msg.payload = fileBytes;
                                node.send(msg);
                                break;
                            case 'put':
                                let putFtpFileName = path.join(node.workdir, node.filename);
                                if (msg.payload.filename) putFtpFileName = msg.payload.filename;

                                let put = await sftp.put(msg.payload, putFtpFileName);

                                msg.payload = put;
                                node.send(msg);
                                break;
                            case 'delete':
                                let delFtpFileName = path.join(node.workdir, node.filename);
                                if (msg.payload.filename) delFtpFileName = msg.payload.filename;
                                let del = await sftp.delete(delFtpFileName);
                                msg.payload = del;
                                node.send(msg);
                                break;
                            case 'mkdir':
                                let mkdir = await sftp.mkdir(node.workdir, false);
                                msg.payload = mkdir;
                                node.send(msg);
                                break;
                            case 'rmdir':
                                let rmdir = await sftp.rmdir(node.workdir, false);
                                msg.payload = rmdir;
                                node.send(msg);
                                break;
                            default:
                                node.status({ fill: 'red', shape: 'ring', text: 'failed' });
                                node.error('Invalid operation');
                                reject('Invalid operation');
                                break;
                        }

                        node.status({ fill: 'gray', shape: 'ring', text: 'done!' });
                        resolve('success');
                    } catch (err) {
                        node.status({ fill: 'red', shape: 'ring', text: 'failed' });
                        node.error(err ? err.toString() : 'Unknown error' );
                        reject(err);
                    } finally {
                        sftp.end();
                        node.running = false;
                        node.status({});
                    }
                });
            } catch (error) {
                node.error(error);
            }
        });
    }
    RED.nodes.registerType('sftp in', SFtpInNode);
};

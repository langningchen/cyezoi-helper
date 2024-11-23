import * as vscode from 'vscode';
import path from 'path';
import { outputChannel } from './io';
import { marked } from 'marked';
import auth from './auth';
import settings from './settings';

export interface WebviewData {
    name: string;
    extensionPath: string;
    data: { [key: string]: any };
    getTitle: () => string;
    fetchData: (postMessage: (message: any) => void,
        addTempFile: (file: string) => void,
        parseMarkdown: (markdown: string, prefix?: string) => Promise<{ fetchData: { [key: string]: string }, content: string }>,
        dispose: () => void) => void;
}

interface WebviewMessage {
    command: string;
    data: string[];
}

export default class {
    private panel: vscode.WebviewPanel;
    private tempFiles: string[] = [];
    private webviewData: WebviewData;
    private shortName: string;

    constructor(data: WebviewData) {
        this.webviewData = data;
        this.shortName = this.webviewData.name.charAt(0) + "Web";

        outputChannel.trace(`[${this.shortName}    ]`, '"constructor"', data);
        outputChannel.info(`Open webview`, `"${this.webviewData.getTitle()}"`);
        this.panel = vscode.window.createWebviewPanel(
            this.webviewData.name,
            `CYEZOI - ` + this.webviewData.getTitle(),
            vscode.ViewColumn.Active,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            },
        );

        this.panel.webview.html = this.getHtml();
        this.panel.webview.onDidReceiveMessage((message: WebviewMessage) => {
            if (message.command === 'refresh') {
                this.fetchData();
            } else {
                vscode.commands.executeCommand(`cyezoi.${message.command}`, ...message.data);
            }
        });
        this.panel.onDidDispose(this.cleanup);

        try {
            this.fetchData();
        } catch (e) {
            this.cleanup();
        }
    }

    private getRealPath = (relativePath: string[]): vscode.Uri => {
        return this.panel?.webview.asWebviewUri(
            vscode.Uri.file(path.join(this.webviewData.extensionPath, ...relativePath)),
        );
    };

    private getHtml = () => {
        outputChannel.trace(`[${this.shortName}    ]`, '"getHtml"');
        let htmlContent = require('fs').readFileSync(path.join(this.webviewData.extensionPath, 'res', 'html', 'base.html'), 'utf8');
        htmlContent = htmlContent.replace("{{hydroIcons}}", this.getRealPath(['res', 'fonts', 'hydro-icons.woff2']).toString());
        htmlContent = htmlContent.replace("{{vscodeElements}}", this.getRealPath(['res', 'libs', 'vscode-elements', 'bundled.js']).toString());
        htmlContent = htmlContent.replace("{{codicon}}", this.getRealPath(['res', 'libs', 'codicon', 'codicon.css']).toString());
        htmlContent = htmlContent.replace("{{static}}", this.getRealPath(['res', 'html', 'static.js']).toString());
        htmlContent = htmlContent.replace("{{dynamic}}", this.getRealPath(['res', 'html', `${this.webviewData.name}.js`]).toString());
        outputChannel.debug('HTML content', htmlContent);
        return htmlContent;
    };

    private fetchData = () => {
        outputChannel.trace(`[${this.shortName}    ]`, '"fetchData"');
        this.webviewData.fetchData((message) => {
            this.panel.webview.postMessage(message);
        }, (file) => {
            this.tempFiles.push(file);
        }, async (markdown, prefix?) => {
            const fetchData: { [key: string]: string } = {};
            markdown = markdown.replace(/\@\[(video|pdf)\]\((.+?)\)/g, (match, type, url) => {
                if (url.startsWith('file://')) {
                    url = prefix + '/' + url.substring(7);
                }
                url = url.replace(/\?.*$/, '');
                const id = Math.random().toString(36).slice(2);
                fetchData[id] = url;
                if (type === 'video') {
                    return `<video src="{{${id}}}" controls></video>`;
                }
                else if (type === 'pdf') {
                    return `<div data-src="{{${id}}}" class="pdf"></div>`;
                }
                return '<a href="' + id + '">' + url + '</a>';
            });
            for (const [key, value] of Object.entries(fetchData)) {
                const responseData = await fetch(`http${settings.safeProtocol ? "s" : ""}://${settings.server}${value}`, {
                    headers: {
                        'cookie': await auth.getCookiesValue(),
                    },
                    redirect: 'follow',
                });
                const filePath = vscode.Uri.file(`${this.webviewData.extensionPath}/temp/${key}`);
                await vscode.workspace.fs.writeFile(filePath, new Uint8Array(await responseData.arrayBuffer()));
                const webviewUri = this.panel.webview.asWebviewUri(filePath);
                outputChannel.info('Saved', `"http${settings.safeProtocol ? "s" : ""}://${settings.server}${value}"`, 'to file', `"${filePath.toString()}"`, 'url', `"${webviewUri.toString()}"`);
                fetchData[key] = webviewUri.toString();
            }
            return {
                fetchData,
                content: await marked(markdown),
            };
        }, () => {
            this.panel.dispose();
        });
    };

    private cleanup = () => {
        outputChannel.trace(`[${this.shortName}    ]`, '"cleanup"');
        for (const id of this.tempFiles) {
            const filePath = vscode.Uri.file(path.join(this.webviewData.extensionPath, 'temp', id));
            vscode.workspace.fs.delete(filePath);
            outputChannel.info("Delete temp file", `"${filePath.toString()}"`);
        }
    };
}

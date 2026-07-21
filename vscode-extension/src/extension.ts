import * as vscode from 'vscode';
import { BrainSidebarProvider } from './BrainSidebarProvider.js';

export function activate(context: vscode.ExtensionContext) {
  console.log('Company Brain & Enterprise Semantic Cache Extension Activated!');

  const provider = new BrainSidebarProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      BrainSidebarProvider.viewType,
      provider
    )
  );
}

export function deactivate() {}

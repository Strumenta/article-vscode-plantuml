import * as vscode from 'vscode';
import { diagramsOf } from '../plantuml/diagram/tools';
import { localize } from '../plantuml/common';
import {ANTLRErrorListener, CharStreams, CommonTokenStream, Recognizer} from "antlr4ts";
import {PumlgLexer} from "../parser/PumlgLexer";
import {PumlgParser} from "../parser/PumlgParser";
import {Token} from "antlr4ts/Token";
import {Diagram} from "../plantuml/diagram/diagram";
import {RecognitionException} from "antlr4ts/RecognitionException";

function rangeOfToken(token: Token, d: Diagram) {
    if (token) {
        return {
            start: new vscode.Position(token.line, token.charPositionInLine).translate(d.start.line, d.start.character),
            end: new vscode.Position(token.line, token.text.length).translate(d.start.line, d.start.character),
        }
    }
}

export class Diagnoser extends vscode.Disposable {
    private _disposables: vscode.Disposable[] = [];
    private DiagnosticCollection: vscode.DiagnosticCollection;
    private langID: string;
    private extName: string;

    constructor(ext: vscode.Extension<any>) {
        super(() => this.dispose());
        this.langID = ext.packageJSON.contributes.languages[0].id;
        this.extName = ext.packageJSON.name;
        this.DiagnosticCollection = vscode.languages.createDiagnosticCollection(this.extName);
        this._disposables.push(
            this.DiagnosticCollection,
            vscode.workspace.onDidOpenTextDocument(doc => this.diagnose(doc)),
            vscode.workspace.onDidChangeTextDocument(e => this.diagnose(e.document)),
            vscode.workspace.onDidCloseTextDocument(doc => this.removeDiagnose(doc)),
        );
    }

    dispose() {
        this._disposables && this._disposables.length && this._disposables.map(d => d.dispose());
    }

    diagnose(document: vscode.TextDocument) {
        if (document.languageId !== this.langID) return;
        let diagnostics: vscode.Diagnostic[] = [];
        let names = {};
        let diagrams = diagramsOf(document);
        diagrams.map(d => {
            let range = document.lineAt(d.start.line).range;
            if (!d.titleRaw) {
                diagnostics.push(
                    new vscode.Diagnostic(
                        range,
                        localize(30, null),
                        vscode.DiagnosticSeverity.Warning
                    )
                );
            }
            if (names[d.title]) {
                diagnostics.push(
                    new vscode.Diagnostic(
                        range,
                        localize(31, null, d.title),
                        vscode.DiagnosticSeverity.Error
                    )
                );
            } else {
                names[d.title] = true;
            }

            //Report parse errors
            const text = document.getText(new vscode.Range(d.start, d.end));
            const input = CharStreams.fromString(text);
            const lexer = new PumlgLexer(input);
            const tokenStream = new CommonTokenStream(lexer);
            const parser = new PumlgParser(tokenStream);

            class ReportingLexerErrorListener implements ANTLRErrorListener<number> {
                syntaxError? = <T extends number>(recognizer: Recognizer<T, any>, offendingSymbol: T | undefined, line: number, charPositionInLine: number, msg: string, e: RecognitionException | undefined) => {
                    let range = null;
                    if(e) {
                        let token = e.getOffendingToken();
                        range = rangeOfToken(token, d);
                    }
                    let diagnostic: vscode.Diagnostic = {
                        severity: vscode.DiagnosticSeverity.Error,
                        range: range,
                        message: msg,
                        source: 'PlantUML syntax checker'
                    };
                    diagnostics.push(diagnostic);
                };
            }
            lexer.addErrorListener(new ReportingLexerErrorListener());

            class ReportingParserErrorListener implements ANTLRErrorListener<Token> {
                syntaxError? = <T extends Token>(recognizer: Recognizer<T, any>, offendingSymbol: T | undefined, line: number, charPositionInLine: number, msg: string, e: RecognitionException | undefined) => {
                    let range;
                    if(e) {
                        let token = e.getOffendingToken();
                        range = rangeOfToken(token, d);
                    } else {
                        range = rangeOfToken(offendingSymbol, d);
                    }
                    let diagnostic: vscode.Diagnostic = {
                        severity: vscode.DiagnosticSeverity.Error,
                        range: range,
                        message: msg,
                        source: 'XULE syntax checker'
                    };
                    diagnostics.push(diagnostic);
                };
            }
            parser.addErrorListener(new ReportingParserErrorListener());
            parser.uml();
        });
        this.removeDiagnose(document);
        this.DiagnosticCollection.set(document.uri, diagnostics);
    }
    removeDiagnose(document: vscode.TextDocument) {
        this.DiagnosticCollection.delete(document.uri);
    }
}
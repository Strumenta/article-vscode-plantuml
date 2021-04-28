import {AbstractParseTreeVisitor} from "antlr4ts/tree";
import {PumlgVisitor} from "../../parser/PumlgVisitor";
import {Class_declarationContext} from "../../parser/PumlgParser";

export class ExtractNamesVisitor extends AbstractParseTreeVisitor<void> implements PumlgVisitor<void>{
    protected defaultResult(): void {}

    classNames: Set<string> = new Set<string>();

    visitClass_declaration = (ctx: Class_declarationContext) => {
        this.classNames.add(ctx.ident().text);
    };
}
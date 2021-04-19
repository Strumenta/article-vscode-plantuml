import { expect } from "chai";
import { suite, test } from "mocha"
import {CharStreams, CommonTokenStream} from "antlr4ts";
import {PumlgLexer} from "../src/parser/PumlgLexer";
import {PumlgParser} from "../src/parser/PumlgParser";

suite("Parser Tests", () => {
    test("Arbitrary text", () => {
        const cs = CharStreams.fromString("lorem ipsum\ndolor\nsit amet");
        const ts = new CommonTokenStream(new PumlgLexer(cs));
        let parser = new PumlgParser(ts);
        parser.umlFile();
        expect(parser.numberOfSyntaxErrors).to.equal(0);
    });
    test("Arbitrary text before/after class diagram", () => {
        const cs = CharStreams.fromString(`
lorem ipsum
@startuml
class Foo
interface Bar
@enduml
dolor
sit amet`);
        const ts = new CommonTokenStream(new PumlgLexer(cs));
        let parser = new PumlgParser(ts);
        const file = parser.umlFile();
        expect(parser.numberOfSyntaxErrors).to.equal(0);
        expect(file.uml().length).to.equal(1);
    });
    test("Arbitrary text inside diagram", () => {
        const cs = CharStreams.fromString(`
@startuml
This is not valid plantUml: but we don't care. The parser must be lenient.
class Foo //We do care about this.
We can have stuff after the class diagram: we'll ignore it.
We can have blank lines:

Or lines with the word "class" in them, like this.
The following is another class declaration:
class Bar
@enduml`);
        const ts = new CommonTokenStream(new PumlgLexer(cs));
        let parser = new PumlgParser(ts);
        let file = parser.umlFile();
        expect(parser.numberOfSyntaxErrors).to.equal(0);
        expect(file.uml().length).to.equal(1);
        expect(file.uml()[0].diagram().length).to.equal(2);
        expect(file.uml()[0].diagram()[0].class_diagram()).not.to.be.undefined;
        expect(file.uml()[0].diagram()[0].class_diagram().class_declaration().length).to.equal(1);
        expect(file.uml()[0].diagram()[1].class_diagram()).not.to.be.undefined;
        expect(file.uml()[0].diagram()[1].class_diagram().class_declaration().length).to.equal(1);
    });
    test("Class declaration", () => {
        const cs = CharStreams.fromString(`
@startuml
abstract class alias {
    +{static} int PUBLIC_CLASS_VARIABLE
    -string privateVariable
    ~void packagePrivateMethod()
    #{abstract} char protectedMethod(int param)
}
@enduml`);
        const ts = new CommonTokenStream(new PumlgLexer(cs));
        let parser = new PumlgParser(ts);
        let file = parser.umlFile();
        expect(parser.numberOfSyntaxErrors).to.equal(0);
        expect(file.uml().length).to.equal(1);
        expect(file.uml()[0].diagram().length).to.equal(1);
        expect(file.uml()[0].diagram()[0].class_diagram()).not.to.be.undefined;
        expect(file.uml()[0].diagram()[0].class_diagram().class_declaration().length).to.equal(1);
    });
});
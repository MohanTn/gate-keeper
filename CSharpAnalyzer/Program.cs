using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

// ── Entry point ────────────────────────────────────────────────────────────

string? filePath = null;
for (var i = 0; i < args.Length - 1; i++)
    if (args[i] == "--file") { filePath = args[i + 1]; break; }

if (filePath is null || !File.Exists(filePath))
{
    Console.Error.WriteLine($"gate-keeper-cs: file not found: '{filePath}'");
    return 1;
}

var source = await File.ReadAllTextAsync(filePath);
var tree   = CSharpSyntaxTree.ParseText(source, path: filePath);
var root   = (CompilationUnitSyntax)tree.GetRoot();

Console.WriteLine(JsonSerializer.Serialize(
    CsAnalyzer.Analyze(filePath, source, root, tree),
    new JsonSerializerOptions
    {
        PropertyNamingPolicy   = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented          = false,
    }));
return 0;

// ── Output types (camelCase matches TypeScript CSharpAnalysisResult) ───────

record CsSpan(
    [property: JsonPropertyName("line")]      int Line,
    [property: JsonPropertyName("column")]    int Column,
    [property: JsonPropertyName("endLine")]   int EndLine,
    [property: JsonPropertyName("endColumn")] int EndColumn);

record Dependency(
    [property: JsonPropertyName("source")] string Source,
    [property: JsonPropertyName("target")] string Target,
    [property: JsonPropertyName("type")]   string Type,
    [property: JsonPropertyName("weight")] int    Weight);

record Metrics(
    [property: JsonPropertyName("linesOfCode")]          int LinesOfCode,
    [property: JsonPropertyName("cyclomaticComplexity")] int CyclomaticComplexity,
    [property: JsonPropertyName("numberOfMethods")]      int NumberOfMethods,
    [property: JsonPropertyName("numberOfClasses")]      int NumberOfClasses,
    [property: JsonPropertyName("importCount")]          int ImportCount);

record Violation(
    [property: JsonPropertyName("type")]     string  ViolationType,
    [property: JsonPropertyName("ruleId")]   string  RuleId,
    [property: JsonPropertyName("severity")] string  Severity,
    [property: JsonPropertyName("message")]  string  Message,
    [property: JsonPropertyName("line")]     int?    Line  = null,
    [property: JsonPropertyName("span")]     CsSpan? Span  = null,
    [property: JsonPropertyName("fix")]      string? Fix   = null);

record AnalysisResult(
    [property: JsonPropertyName("dependencies")] Dependency[] Dependencies,
    [property: JsonPropertyName("metrics")]      Metrics      Metrics,
    [property: JsonPropertyName("violations")]   Violation[]  Violations,
    [property: JsonPropertyName("definedTypes")] string[]     DefinedTypes);

// ── Analyzer ───────────────────────────────────────────────────────────────

static class CsAnalyzer
{
    public static AnalysisResult Analyze(
        string filePath, string source,
        CompilationUnitSyntax root, SyntaxTree tree)
    {
        var lines      = source.Split('\n');
        var defined    = GetDefinedTypes(root);
        var definedSet = new HashSet<string>(defined, StringComparer.Ordinal);
        return new AnalysisResult(
            GetDependencies(filePath, root, definedSet).ToArray(),
            GetMetrics(root, lines),
            GetViolations(root, tree).ToArray(),
            defined.ToArray());
    }

    // ── defined types ──────────────────────────────────────────────────────

    static List<string> GetDefinedTypes(CompilationUnitSyntax root)
    {
        var types = new List<string>();
        foreach (var node in root.DescendantNodes())
        {
            string? name = node switch
            {
                TypeDeclarationSyntax t => t.Identifier.ValueText,
                EnumDeclarationSyntax e => e.Identifier.ValueText,
                _                       => null,
            };
            if (name is not null && !types.Contains(name)) types.Add(name);
        }
        return types;
    }

    // ── dependencies ──────────────────────────────────────────────────────

    static List<Dependency> GetDependencies(
        string filePath, CompilationUnitSyntax root, HashSet<string> definedHere)
    {
        var deps = new List<Dependency>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        foreach (var u in root.DescendantNodes().OfType<UsingDirectiveSyntax>())
        {
            if (u.StaticKeyword.IsKind(SyntaxKind.StaticKeyword) || u.Alias is not null) continue;
            deps.Add(new Dependency(filePath, u.NamespaceOrType.ToString(), "import", 1));
        }

        foreach (var bt in root.DescendantNodes().OfType<SimpleBaseTypeSyntax>())
        {
            var name = SimpleTypeName(bt.Type);
            if (name is not null && !definedHere.Contains(name) && seen.Add("inh:" + name))
                deps.Add(new Dependency(filePath, "__type__:" + name, "inheritance", 1));
        }

        var walker = new TypeRefWalker(definedHere);
        walker.Visit(root);
        foreach (var name in walker.References)
            if (seen.Add("use:" + name))
                deps.Add(new Dependency(filePath, "__type__:" + name, "usage", 1));

        return deps;
    }

    internal static string? SimpleTypeName(TypeSyntax type) => type switch
    {
        IdentifierNameSyntax id => id.Identifier.ValueText,
        GenericNameSyntax g     => g.Identifier.ValueText,
        QualifiedNameSyntax q   => q.Right.Identifier.ValueText,
        _                       => null,
    };

    // ── metrics ────────────────────────────────────────────────────────────

    static Metrics GetMetrics(CompilationUnitSyntax root, string[] lines)
    {
        int methods = root.DescendantNodes()
            .Count(n => n is MethodDeclarationSyntax or ConstructorDeclarationSyntax);
        int classes = root.DescendantNodes()
            .Count(n => n is TypeDeclarationSyntax or EnumDeclarationSyntax);
        int imports = root.DescendantNodes().OfType<UsingDirectiveSyntax>().Count();
        int cc = 1;
        foreach (var node in root.DescendantNodes()) cc += CcWeight(node);
        return new Metrics(lines.Length, cc, methods, classes, imports);
    }

    static int CcWeight(SyntaxNode node) => node switch
    {
        IfStatementSyntax           => 1,
        WhileStatementSyntax        => 1,
        ForStatementSyntax          => 1,
        ForEachStatementSyntax      => 1,
        CaseSwitchLabelSyntax       => 1,
        CatchClauseSyntax           => 1,
        ConditionalExpressionSyntax => 1,
        BinaryExpressionSyntax b when
            b.IsKind(SyntaxKind.LogicalAndExpression) ||
            b.IsKind(SyntaxKind.LogicalOrExpression)  ||
            b.IsKind(SyntaxKind.CoalesceExpression)   => 1,
        _                           => 0,
    };

    // ── violations ─────────────────────────────────────────────────────────

    const int GodClassLimit      = 20;
    const int LongMethodLines    = 50;
    const int TightCouplingLimit = 5;

    static List<Violation> GetViolations(CompilationUnitSyntax root, SyntaxTree tree)
    {
        var vs = new List<Violation>();
        GodClasses(root, tree, vs);
        LongMethods(root, tree, vs);
        TightCoupling(root, tree, vs);
        EmptyCatch(root, tree, vs);
        MagicNumbers(root, tree, vs);
        TodoMarkers(root, vs);
        NotImplemented(root, tree, vs);
        return vs;
    }

    static CsSpan MakeSpan(SyntaxNode n, SyntaxTree t)
    {
        var ls = t.GetLineSpan(n.Span);
        return new CsSpan(
            ls.StartLinePosition.Line + 1, ls.StartLinePosition.Character + 1,
            ls.EndLinePosition.Line   + 1, ls.EndLinePosition.Character   + 1);
    }

    static int StartLine(SyntaxNode n, SyntaxTree t) =>
        t.GetLineSpan(n.Span).StartLinePosition.Line + 1;

    static int LineCount(SyntaxNode n, SyntaxTree t)
    {
        var ls = t.GetLineSpan(n.Span);
        return ls.EndLinePosition.Line - ls.StartLinePosition.Line + 1;
    }

    static void GodClasses(CompilationUnitSyntax root, SyntaxTree tree, List<Violation> vs)
    {
        foreach (var cls in root.DescendantNodes().OfType<TypeDeclarationSyntax>())
        {
            int mc = cls.Members.OfType<MethodDeclarationSyntax>().Count()
                   + cls.Members.OfType<ConstructorDeclarationSyntax>().Count();
            if (mc <= GodClassLimit) continue;
            var sp = MakeSpan(cls, tree);
            vs.Add(new Violation("god_class", "cs/god-class", "warning",
                $"Class '{cls.Identifier.ValueText}' has {mc} methods — consider splitting (SRP)",
                sp.Line, sp, "Extract related methods into focused classes"));
        }
    }

    static void LongMethods(CompilationUnitSyntax root, SyntaxTree tree, List<Violation> vs)
    {
        foreach (var m in root.DescendantNodes().OfType<MethodDeclarationSyntax>())
        {
            if (m.Body is null) continue;
            int lc = LineCount(m.Body, tree);
            if (lc <= LongMethodLines) continue;
            vs.Add(new Violation("long_method", "cs/long-method", "warning",
                $"Method '{m.Identifier.ValueText}' is {lc} lines — extract into smaller methods",
                StartLine(m, tree), MakeSpan(m, tree),
                "Extract cohesive logic blocks into private helper methods"));
        }
    }

    static void TightCoupling(CompilationUnitSyntax root, SyntaxTree tree, List<Violation> vs)
    {
        foreach (var ctor in root.DescendantNodes().OfType<ConstructorDeclarationSyntax>())
        {
            int pc = ctor.ParameterList.Parameters.Count;
            if (pc <= TightCouplingLimit) continue;
            vs.Add(new Violation("tight_coupling", "cs/tight-coupling", "warning",
                $"Constructor has {pc} parameters — consider a settings object or DI container",
                StartLine(ctor, tree), MakeSpan(ctor.ParameterList, tree),
                "Group related parameters into a settings/options class or use the Builder pattern"));
        }
    }

    static void EmptyCatch(CompilationUnitSyntax root, SyntaxTree tree, List<Violation> vs)
    {
        foreach (var c in root.DescendantNodes().OfType<CatchClauseSyntax>())
        {
            if (c.Block.Statements.Count > 0) continue;
            var sp = MakeSpan(c, tree);
            vs.Add(new Violation("empty_catch", "cs/empty-catch", "error",
                "Empty catch block silently swallows exceptions",
                sp.Line, sp, "At minimum log the exception; consider rethrowing"));
        }
    }

    static void MagicNumbers(CompilationUnitSyntax root, SyntaxTree tree, List<Violation> vs)
    {
        foreach (var literal in root.DescendantNodes().OfType<LiteralExpressionSyntax>())
        {
            if (!literal.IsKind(SyntaxKind.NumericLiteralExpression)) continue;
            var text = literal.Token.Text;
            if (text is "0" or "1" or "0u" or "1u" or "0L" or "1L") continue;
            if (int.TryParse(text, out var ival) && ival >= 0 && ival <= 9) continue;
            if (IsInConstContext(literal)) continue;
            var sp = MakeSpan(literal, tree);
            vs.Add(new Violation("magic_number", "cs/magic-number", "info",
                $"Magic number {text} — extract to a named constant",
                sp.Line, sp, "Replace with a descriptive constant: const int MaxRetries = ..."));
        }
    }

    static bool IsInConstContext(SyntaxNode node)
    {
        for (var p = node.Parent; p is not null; p = p.Parent)
        {
            if (p is FieldDeclarationSyntax fd &&
                fd.Modifiers.Any(m => m.IsKind(SyntaxKind.ConstKeyword))) return true;
            if (p is LocalDeclarationStatementSyntax ld &&
                ld.Modifiers.Any(m => m.IsKind(SyntaxKind.ConstKeyword))) return true;
            if (p is EnumMemberDeclarationSyntax or AttributeArgumentSyntax) return true;
            if (p is TypeDeclarationSyntax or MethodDeclarationSyntax) break;
        }
        return false;
    }

    static readonly System.Text.RegularExpressions.Regex TodoRe =
        new(@"\b(TODO|FIXME|PLACEHOLDER|STUB)\b",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase |
            System.Text.RegularExpressions.RegexOptions.Compiled);
    static readonly System.Text.RegularExpressions.Regex DebtRe =
        new(@"\b(HACK|WORKAROUND|KLUDGE|XXX)\b",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase |
            System.Text.RegularExpressions.RegexOptions.Compiled);

    static void TodoMarkers(CompilationUnitSyntax root, List<Violation> vs)
    {
        foreach (var token in root.DescendantTokens())
        {
            ScanTrivia(token.LeadingTrivia,  vs);
            ScanTrivia(token.TrailingTrivia, vs);
        }
    }

    static void ScanTrivia(SyntaxTriviaList list, List<Violation> vs)
    {
        foreach (var trivia in list)
        {
            if (!trivia.IsKind(SyntaxKind.SingleLineCommentTrivia) &&
                !trivia.IsKind(SyntaxKind.MultiLineCommentTrivia)) continue;
            var text   = trivia.ToString();
            var lineNo = trivia.GetLocation().GetLineSpan().StartLinePosition.Line + 1;
            var m = TodoRe.Match(text);
            if (m.Success)
            {
                vs.Add(new Violation("todo_placeholder", "cs/no-todo", "warning",
                    $"{m.Value.ToUpperInvariant()} marker at line {lineNo} — resolve before merging",
                    lineNo, null, "Replace with the actual implementation"));
                continue;
            }
            var d = DebtRe.Match(text);
            if (d.Success)
                vs.Add(new Violation("tech_debt_marker", "cs/tech-debt", "info",
                    $"{d.Value.ToUpperInvariant()} marker at line {lineNo} — track in your issue tracker",
                    lineNo, null, "Create a tracking issue and replace with a proper solution"));
        }
    }

    static void NotImplemented(CompilationUnitSyntax root, SyntaxTree tree, List<Violation> vs)
    {
        foreach (var node in root.DescendantNodes())
        {
            ObjectCreationExpressionSyntax? c = node switch
            {
                ThrowStatementSyntax  { Expression: ObjectCreationExpressionSyntax x } => x,
                ThrowExpressionSyntax { Expression: ObjectCreationExpressionSyntax x } => x,
                _ => null,
            };
            if (c is null || c.Type.ToString() != "NotImplementedException") continue;
            var sp = MakeSpan(node, tree);
            vs.Add(new Violation("unimplemented_stub", "cs/no-stub", "error",
                $"Unimplemented stub at line {sp.Line} — NotImplementedException will throw at runtime",
                sp.Line, sp, "Implement the required functionality"));
        }
    }
}

// ── TypeRefWalker — collects PascalCase type names from declaration sites ──

class TypeRefWalker : CSharpSyntaxWalker
{
    private readonly HashSet<string> _definedHere;
    public readonly HashSet<string> References = new(StringComparer.Ordinal);

    public TypeRefWalker(HashSet<string> definedHere) => _definedHere = definedHere;

    static readonly HashSet<string> Builtins = new(StringComparer.Ordinal)
    {
        "String","Int32","Int64","Boolean","Byte","Char","Decimal","Double","Single",
        "Object","Void","DateTime","DateTimeOffset","TimeSpan","Guid",
        "Task","ValueTask","List","Dictionary","HashSet","IEnumerable","IList",
        "IDictionary","ICollection","IQueryable","ILogger","IConfiguration",
        "CancellationToken","Exception","ArgumentException","ArgumentNullException",
        "InvalidOperationException","NotImplementedException","NotSupportedException",
        "Action","Func","Predicate","EventHandler","Nullable","Lazy",
        "Console","Math","Convert","Enumerable","StringBuilder",
        "File","Path","Directory","Stream","StreamReader","StreamWriter",
        "HttpClient","HttpContext","HttpRequest","HttpResponse",
        "IServiceProvider","IServiceCollection","DbContext","DbSet",
    };

    public override void VisitObjectCreationExpression(ObjectCreationExpressionSyntax n)
    { Add(n.Type); base.VisitObjectCreationExpression(n); }

    public override void VisitVariableDeclaration(VariableDeclarationSyntax n)
    { Add(n.Type); base.VisitVariableDeclaration(n); }

    public override void VisitParameter(ParameterSyntax n)
    { if (n.Type is not null) Add(n.Type); base.VisitParameter(n); }

    public override void VisitMethodDeclaration(MethodDeclarationSyntax n)
    { Add(n.ReturnType); base.VisitMethodDeclaration(n); }

    public override void VisitPropertyDeclaration(PropertyDeclarationSyntax n)
    { Add(n.Type); base.VisitPropertyDeclaration(n); }

    public override void VisitFieldDeclaration(FieldDeclarationSyntax n)
    { Add(n.Declaration.Type); base.VisitFieldDeclaration(n); }

    void Add(TypeSyntax type)
    {
        var name = CsAnalyzer.SimpleTypeName(type);
        if (name is null || !char.IsUpper(name[0])) return;
        if (Builtins.Contains(name) || _definedHere.Contains(name)) return;
        References.Add(name);
    }
}

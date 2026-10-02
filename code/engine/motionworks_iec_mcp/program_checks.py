"""Conservative, source-linked programming review; never mutates a project."""
from __future__ import annotations
import re
from collections import Counter
from pathlib import Path
from .variables import parse_declarations
from .knowledge import reference, signature

IDENT = r'[A-Za-z_][A-Za-z_0-9]*'
INTEGER_RANGES = {
    'SINT': (-128, 127), 'USINT': (0, 255), 'INT': (-32768, 32767), 'UINT': (0, 65535),
    'DINT': (-2147483648, 2147483647), 'UDINT': (0, 4294967295),
    'LINT': (-2**63, 2**63-1), 'ULINT': (0, 2**64-1),
    'BYTE': (0, 255), 'WORD': (0, 65535), 'DWORD': (0, 2**32-1), 'LWORD': (0, 2**64-1),
}
ELEMENTARY = set(INTEGER_RANGES) | {'BOOL', 'REAL', 'LREAL', 'TIME', 'STRING', 'WSTRING', 'DATE', 'TOD', 'DT'}


def mask(text):
    """Mask nested comments and IEC strings while preserving offsets and newlines."""
    out = list(text); i = 0; depth = 0; quote = None
    def blank(pos, count=1):
        for j in range(pos, min(pos+count, len(text))):
            if text[j] not in '\r\n': out[j] = ' '
    while i < len(text):
        pair = text[i:i+2]
        if depth:
            if pair == '(*': depth += 1; blank(i, 2); i += 2
            elif pair == '*)': depth -= 1; blank(i, 2); i += 2
            else: blank(i); i += 1
        elif quote:
            if text[i] == '$': blank(i, 2); i += 2
            elif text[i] == quote:
                if i+1 < len(text) and text[i+1] == quote: blank(i, 2); i += 2
                else: blank(i); quote = None; i += 1
            else: blank(i); i += 1
        elif pair == '(*': depth = 1; blank(i, 2); i += 2
        elif pair == '//':
            end = text.find('\n', i)
            end = len(text) if end < 0 else end
            blank(i, end-i); i = end
        elif text[i] in "'\"": quote = text[i]; blank(i); i += 1
        else: i += 1
    return ''.join(out)


def calls(body):
    clean = mask(body)
    for match in re.finditer(r'(?<![.\w])('+IDENT+r')\s*\(', clean):
        depth = 1; i = match.end(); start = i; parts = []
        while i < len(clean) and depth:
            char = clean[i]
            if char in '([': depth += 1
            elif char in ')]': depth -= 1
            if depth == 1 and char == ',': parts.append((start, i)); start = i+1
            if depth == 0: parts.append((start, i))
            i += 1
        if depth: continue
        args = []
        for first, last in parts:
            # Masked strings look like whitespace. Stop at the operator so its
            # original literal is not consumed as trailing whitespace.
            param = re.match(r'\s*('+IDENT+r')\s*(:=|=>)', clean[first:last])
            if param:
                args.append((param[1], param[2], body[first+param.end():last].strip()))
        yield match[1], args, clean.count('\n', 0, match.start())+1


def norm(type_name):
    return re.sub(r'\s+', '', type_name).upper()


def expression_type(expr, types):
    expr = expr.strip()
    if re.fullmatch(IDENT, expr):
        if expr.upper() in ('TRUE', 'FALSE'): return 'BOOL'
        return types.get(expr.upper())
    typed = re.fullmatch(r'('+IDENT+r')#[A-Za-z_0-9.+-]+', expr)
    if typed:
        literal_type = typed[1].upper()
        return {'T': 'TIME', 'D': 'DATE', 'TIME_OF_DAY': 'TOD', 'DATE_AND_TIME': 'DT'}.get(literal_type, literal_type)
    return None  # Untyped literals, conversions, arrays and compound expressions need compiler context.


def integer_literal(expr):
    value = expr.strip().replace('_', '')
    if re.fullmatch(r'[+-]?\d+', value): return int(value)
    match = re.fullmatch(r'(?:(?:SINT|USINT|INT|UINT|DINT|UDINT|LINT|ULINT|BYTE|WORD|DWORD|LWORD)#)?(?:(2|8|16)#)?([+-]?[0-9A-F]+)', value, re.I)
    if not match: return None
    try: return int(match[2], int(match[1] or 10))
    except ValueError: return None


def constant_expression(expr):
    """Recognize complete IEC literals, without treating members/indexes as constants."""
    value = expr.strip()
    if value.upper() in ('TRUE', 'FALSE') or integer_literal(value) is not None:
        return True
    if re.fullmatch(r'[+-]?\d[\d_]*(?:\.[\d_]+(?:[Ee][+-]?\d[\d_]*)?|[Ee][+-]?\d[\d_]*)', value):
        return True
    # A typed literal cannot designate writable storage. Its validity is still
    # the compiler's job; DATE/TIME spelling must not hide a non-variable binding.
    if re.fullmatch(r'(?:'+IDENT+r')#[^;\r\n]+', value):
        return True
    return bool(re.fullmatch(r"'(?:\$[^\r\n]|''|[^'$])*'|\"(?:\$[^\r\n]|\"\"|[^\"$])*\"", value))


def review(body, declarations, globals_text=None, *, signatures=None):
    table = parse_declarations(declarations)
    globals_table = parse_declarations(globals_text) if globals_text is not None else None
    variables = {v.name.upper(): v for v in table.variables}
    types = {n: norm(v.type_name) for n, v in variables.items()}
    globals_ = {v.name.upper(): v for v in globals_table.variables} if globals_table else {}
    findings, unresolved = [], set()
    def add(code, message, topic, severity='warning', line=None, evidence=None):
        findings.append({'code': code, 'severity': severity, 'message': message, 'line': line,
                         'reference': evidence or reference(topic), 'automatic_fix': False})
    for warning in table.warnings:
        add('declarations-incomplete', warning, 'scope')
    for name, variable in variables.items():
        if variable.section == 'VAR_EXTERNAL' and globals_table is not None and not globals_table.warnings:
            if name not in globals_:
                add('external-missing-global', f'{variable.name} has no resource global declaration.', 'scope', 'error', variable.line)
            elif norm(variable.type_name) != norm(globals_[name].type_name):
                severity = 'error' if types[name] in ELEMENTARY and norm(globals_[name].type_name) in ELEMENTARY else 'warning'
                add('external-type-mismatch', f'{variable.name}: POU type {variable.type_name}, resource type {globals_[name].type_name}.', 'scope', severity, variable.line)
        elif name in globals_ and variable.section != 'VAR_EXTERNAL':
            add('local-shadows-global', f'{variable.name} is local and also names a resource global; confirm the intended scope.', 'scope', line=variable.line)
        if variable.initial_value and types[name] in INTEGER_RANGES:
            value = integer_literal(variable.initial_value)
            low, high = INTEGER_RANGES[types[name]]
            if value is not None and not low <= value <= high:
                add('initializer-out-of-range', f'{variable.name} initializer {value} exceeds {variable.type_name} [{low}, {high}].', 'strict-types', 'error', variable.line)
    clean = mask(body)
    # Check direct variable-to-variable assignments only; complex expressions stay unresolved.
    for match in re.finditer(r'(?<![.\w])('+IDENT+r')\s*:=\s*([^;\n]+);', clean):
        target, expression = match[1].upper(), match[2].strip()
        if target not in types: continue
        # Named call arguments must not be mistaken for assignments to homonymous locals.
        prefix = clean[:match.start()]
        if prefix.count('(') != prefix.count(')'): continue
        line = clean.count('\n', 0, match.start())+1
        actual = expression_type(expression, types)
        expected = types[target]
        if actual and expected in ELEMENTARY and actual in ELEMENTARY and expected != actual:
            add('explicit-conversion-review', f'{match[1]} is {expected}; assigned expression is {actual}. Check an explicit conversion.', 'strict-types', line=line)
        if expected in INTEGER_RANGES:
            value = integer_literal(expression)
            low, high = INTEGER_RANGES[expected]
            if value is not None and not low <= value <= high:
                add('assignment-out-of-range', f'{match[1]} value {value} exceeds {expected} [{low}, {high}].', 'strict-types', 'error', line)
    call_counts = Counter()
    for instance, args, line in calls(body):
        variable = variables.get(instance.upper())
        if not variable: continue
        type_name = variable.type_name
        # An explicit unresolved installed interface must not silently fall back
        # to a historical signature for a different library revision.
        key = type_name.upper()
        spec = signatures[key] if signatures is not None and key in signatures else signature(type_name)
        if spec is None:
            unresolved.add(type_name); continue
        call_counts[instance.upper()] += 1
        local = spec.get('authority') in ('project_declaration', 'bound_installed_declaration')
        severity = 'error' if local else 'warning'
        evidence = spec.get('citation') or reference('execute')
        pins = {n.upper(): (direction, norm(t)) for direction in ('inputs', 'outputs', 'inouts') for n, t in spec[direction].items()}
        seen = set()
        for name, operator, expr in args:
            pin = name.upper()
            if pin in seen: add('duplicate-fb-parameter', f'{instance}: parameter {name} is supplied twice.', 'execute', 'error', line, evidence)
            seen.add(pin)
            if pin not in pins:
                if spec.get('complete'): add('unknown-fb-parameter', f'{instance} ({type_name}) has no {name} pin in the referenced interface.', 'execute', severity, line, evidence)
                continue
            direction, expected = pins[pin]
            unsupported = {n.upper(): note for n, note in spec.get('unsupported_pins', {}).items()}
            if pin in unsupported:
                add('historical-unsupported-pin', f'{instance}.{name}: {unsupported[pin]} Confirm installed library support.', 'execute', 'warning', line, evidence)
            if (direction == 'outputs' and operator == ':=') or (direction != 'outputs' and operator == '=>'):
                add('fb-parameter-direction', f'{instance}.{name} is {direction}; review {operator} binding.', 'execute', severity, line, evidence)
            actual = expression_type(expr, types)
            if actual and actual != expected and not expected.startswith('ANY'):
                add('fb-parameter-type', f'{instance}.{name}: expected {expected}, found {actual}.', 'strict-types', severity, line, evidence)
            if direction in ('inouts', 'outputs'):
                if constant_expression(expr):
                    code = 'fb-inout-needs-variable' if direction == 'inouts' else 'fb-output-needs-variable'
                    add(code, f'{instance}.{name} needs writable variable storage, not a constant.', 'execute', severity, line, evidence)
                elif not (re.fullmatch(IDENT, expr) and expr.upper() in variables):
                    add('fb-writable-binding-unresolved', f'{instance}.{name}: writable storage for {expr} is not resolved; inspect member/index declarations and compiler diagnostics.', 'execute', 'warning', line, evidence)
        for name in spec['inouts']:
            if name.upper() not in seen:
                add('fb-inout-binding-review', f'{instance}.{name} is not bound in this call; confirm its existing binding.', 'execute', line=line, evidence=evidence)
        if any(n.upper() == 'EXECUTE' for n in spec['inputs']):
            if any(n.upper() == 'EXECUTE' and e.upper() == 'TRUE' for n, _, e in args):
                add('execute-held-true', f'{instance}: constant TRUE provides no recurring rising edge; verify intentional one-shot operation and rearming.', 'execute', line=line)
        # Explicit outputs mapped with => count as handled, as do member accesses.
        if any(n.upper() == 'ERROR' for n in spec['outputs']):
            handles_error = any(n.upper() == 'ERROR' and op == '=>' for n, op, _ in args) or bool(re.search(r'\b'+re.escape(instance)+r'\s*\.\s*Error\b', clean, re.I))
            if not handles_error: add('fb-error-not-observed', f'{instance}: no Error output binding or member reference was found.', 'fb-results', line=line)
    for instance, count in call_counts.items():
        if count > 1: add('multiple-fb-call-sites', f'{instance} has {count} call sites; check mutually exclusive branches and scan order.', 'execute')
    return {'findings': findings, 'unresolved_signatures': sorted(unresolved),
            'global_scope': 'unresolved' if globals_table is None or globals_table.warnings else 'reviewed',
            'coverage': 'Direct ST assignments and resolved named FB calls; not a full IEC compiler or control-flow proof.'}


def task_review(programs, assignments, *, exact_bindings=False):
    findings = []
    assigned = {p.casefold() for entries in assignments.values() for p in entries}
    for program in programs:
        if program.casefold() not in assigned:
            findings.append({'code': 'program-task-binding-review', 'severity': 'warning',
                'message': (f'{program} has no direct PROGRAM instance in the saved task tree; inspect indirect calls and current IDE state.' if exact_bindings else f'{program} has no matching task entry; confirm program type versus instance name and indirect calls.'),
                'reference': reference('task-order'), 'binding_resolution': 'exact' if exact_bindings else 'instance_names_only'})
    return findings


def interface_signature(interface):
    """Keep the exact bound interface and source hashes in review citations."""
    if interface.get('kind') != 'FUNCTION_BLOCK' or interface.get('hidden') or interface.get('evidence_kind') != 'installed-declared-block-interface':
        raise ValueError('Requires a visible declared function-block interface')
    spec = {key: {} for key in ('inputs', 'outputs', 'inouts')}
    directions = {'input': 'inputs', 'output': 'outputs', 'in_out': 'inouts'}
    seen = set()
    for pin in interface['pins']:
        key = pin['name'].upper()
        if key in seen or pin['direction'] not in directions or not pin['type']:
            raise ValueError('Ambiguous interface pin')
        seen.add(key); spec[directions[pin['direction']]][pin['name']] = pin['type']
    spec.update(complete=True, authority='bound_installed_declaration', citation={
        key: interface[key] for key in ('library', 'binding', 'origin', 'source_file', 'source_stream',
                                       'source_sha256', 'reference_registry', 'registry_sha256')})
    return spec


def check_project(root, *, pou=None, body=None, native_libraries=None, interface_libraries=None):
    from .project import Project
    root = Path(root)
    if root.suffix.lower() == '.mwt': root = root.with_suffix('')
    project = Project(root=root)
    selected = {}
    for name, library in (interface_libraries or {}).items():
        if not re.fullmatch(IDENT, name) or not isinstance(library, str) or not re.fullmatch(IDENT, library) or name.upper() in selected:
            raise ValueError('Invalid or duplicate interface library selector')
        selected[name.upper()] = library
    if selected and native_libraries is None:
        raise ValueError('Interface library selection requires bound installed review')
    findings, coverage = [], []
    globals_text = None
    try:
        resources = [p for p in root.glob('C/**/src.st1') if p.parent.name.casefold() == 'resource']
        if len(resources) > 1:
            raise ValueError('Multiple resources: POU-to-resource scope cannot yet be resolved')
        table = project.global_variables()
        if not table.warnings:
            globals_text = '\n'.join(f'VAR_GLOBAL\n{v.name}:{v.type_name};\nEND_VAR' for v in table.variables)
        else: coverage.append({'globals': 'unresolved', 'warnings': table.warnings})
    except Exception as exc: coverage.append({'globals': 'unresolved', 'error': str(exc)})
    signatures = {}
    for item in project.pous():
        try:
            table = item.declarations()
            pins = {section: {v.name: v.type_name for v in table.variables if v.section == section}
                    for section in ('VAR_INPUT', 'VAR_OUTPUT', 'VAR_IN_OUT')}
            if not table.warnings and any(pins.values()):
                signatures[item.name.upper()] = {'inputs': pins['VAR_INPUT'], 'outputs': pins['VAR_OUTPUT'], 'inouts': pins['VAR_IN_OUT'],
                    'complete': True, 'authority': 'project_declaration', 'citation': {'path': str(item.source_path), 'section': 'native POU declaration', 'version_match': 'project_source'}}
        except Exception: continue
    interface_coverage = {}
    for item in ([project.pou(pou)] if pou else project.pous()):
        try:
            if item.language() == 'IL':
                coverage.append({'pou': item.name, 'language': 'IL', 'status': 'IL_static_review_not_supported'})
                continue
            text = body if body is not None and pou else item.st_body()
            if text is None:
                coverage.append({'pou': item.name, 'status': 'graphical_body_not_analyzed'}); continue
            cfb = item.source()
            declaration = next(n for n in cfb.stream_names() if n.upper().endswith('.VB'))
            if native_libraries is not None:
                from .block_interfaces import inspect
                variables = {v.name.upper(): v for v in item.declarations().variables}
                for instance, _, _ in calls(text):
                    variable = variables.get(instance.upper())
                    if not variable or variable.type_name.upper() in signatures: continue
                    type_name = variable.type_name
                    try:
                        spec = interface_signature(inspect(root, native_libraries, type_name, selected.get(type_name.upper())))
                        signatures[type_name.upper()] = spec
                        interface_coverage[type_name.upper()] = {'type': type_name, 'status': 'bound_installed_interface', 'citation': spec['citation']}
                    except Exception as exc:
                        signatures[type_name.upper()] = None
                        interface_coverage[type_name.upper()] = {'type': type_name, 'status': 'unresolved', 'error': str(exc)}
            report = review(text, cfb.read_stream(declaration).decode('latin1'), globals_text, signatures=signatures)
            findings.extend({**f, 'pou': item.name} for f in report['findings'])
            coverage.append({'pou': item.name, 'status': 'ST_reviewed', 'unresolved_signatures': report['unresolved_signatures']})
        except Exception as exc: coverage.append({'pou': item.name, 'status': 'unresolved', 'error': str(exc)})
    try:
        from .task_bindings import inspect
        task_bindings = inspect(root)
        assignments = {task['path']: [x['type'] for x in task['instances']] for task in task_bindings['bindings']}
        findings.extend(task_review(task_bindings['program_types'], assignments, exact_bindings=True))
        coverage.append({'tasks': 'exact_saved_tree', 'bindings': task_bindings['bindings'], 'source_hashes': task_bindings['source_hashes']})
    except Exception as exc: coverage.append({'tasks': 'unresolved', 'error': str(exc)})
    return {'project': str(root), 'findings': findings, 'coverage': coverage,
            'interface_resolution': 'bound_installed_requested' if native_libraries is not None else 'project_and_historical',
            'installed_interfaces': list(interface_coverage.values()),
            'errors': sum(f['severity'] == 'error' for f in findings),
            'warnings': sum(f['severity'] == 'warning' for f in findings),
            'verification': 'static_review_only', 'automatic_changes': False,
            'limitations': ['No arbitrary LD/FBD analysis', 'No IL static syntax/semantic review; require native compilation', 'No complete IEC type inference', 'Saved task ownership is not runtime execution proof', 'Historical vendor signatures require installed-version confirmation']}

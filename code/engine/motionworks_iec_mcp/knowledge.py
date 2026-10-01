"""Versioned vendor references and bounded local PDF search. No IDE operations."""
from __future__ import annotations
import hashlib
import json
import os
import re
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from uuid import uuid4

DATA = Path(__file__).with_name('reference_data')
MAX_DOWNLOAD = 64 * 1024 * 1024


def catalog():
    return json.loads((DATA / 'catalog.json').read_text(encoding='utf-8'))


def citation(source_id, pages=None, section=None):
    source = next(s for s in catalog()['sources'] if s['id'] == source_id)
    return {**source, 'pdf_pages': pages or [], 'section': section,
            'page_url': source['url'] + (f'#page={pages[0]}' if pages else ''),
            'version_match': 'not_verified_against_installed_library'}


def reference(topic_id):
    topic = next(t for t in catalog()['topics'] if t['id'] == topic_id)
    return {**topic, 'citation': citation(topic['source_id'], topic['pdf_pages'], topic['section'])}


def tokens(text):
    return re.findall(r'[a-z0-9_]+', text.casefold())


def _score(query, text):
    wanted = set(tokens(query))
    actual = set(tokens(text))
    # Full-phrase matching also helps PDFs whose glyph extraction omits spaces.
    compact = re.sub(r'\s+', '', text.casefold())
    phrase = re.sub(r'\s+', '', query.casefold())
    return len(wanted & actual) + (4 if phrase and phrase in compact else 0)


def cache_root():
    from .staging import workspace_root
    workspace = workspace_root()
    root = (workspace / '.motionworks' / 'references').resolve()
    if not root.is_relative_to(workspace):
        raise ValueError('Reference cache escapes the workspace')
    return root


def _safe_child(root, name):
    path = root / name
    if not path.resolve().is_relative_to(root):
        raise ValueError('Linked reference cache entry escapes its directory')
    return path


def search(query='', *, source_id=None, limit=5):
    limit = max(1, min(int(limit), 10))
    data = catalog()
    if source_id and source_id not in {s['id'] for s in data['sources']}:
        raise ValueError('Unknown source_id')
    if not query.strip():
        return {'sources': [s for s in data['sources'] if not source_id or s['id'] == source_id], 'topics': [{'id': t['id'], 'title': t['title']} for t in data['topics'] if not source_id or t['source_id'] == source_id],
                'signatures': sorted(data['signatures']), 'note': 'Curated notes work offline; sync PDFs for page search.'}
    if len(query) > 256: raise ValueError('Reference query must be at most 256 characters')
    scored = []
    for topic in data['topics']:
        if source_id and topic['source_id'] != source_id: continue
        score = _score(query, ' '.join([topic['title'], topic['summary'], *topic['tags']]))
        if score: scored.append((score, topic['id']))
    curated = [reference(id) for _, id in sorted(scored, key=lambda x: (-x[0], x[1]))[:limit]]
    pages, unavailable = [], []
    exact_signature = signature(query.strip())
    root = cache_root()
    for source in data['sources']:
        if source['kind'] != 'pdf' or (source_id and source['id'] != source_id): continue
        path = _safe_child(root, source['id'] + '.json')
        if not path.exists():
            unavailable.append(source['id']); continue
        try:
            cached = json.loads(path.read_text(encoding='utf-8'))
            pdf = _safe_child(root, source['id'] + '.pdf')
            if cached['sha256'] != source['sha256'] or hashlib.sha256(pdf.read_bytes()).hexdigest() != source['sha256']:
                raise ValueError('Cached PDF version/hash does not match reviewed source')
            if len(cached['pages']) != source['pages'] or not all(isinstance(p, str) for p in cached['pages']):
                raise ValueError('Cached page index is incomplete')
            if cached.get('text_sha256') != hashlib.sha256(json.dumps(cached['pages'], ensure_ascii=False).encode('utf-8')).hexdigest():
                raise ValueError('Cached page index failed integrity check; synchronize again')
            best = []
            for i, text in enumerate(cached['pages'], 1):
                score = _score(query, text)
                if score:
                    score += min(3, text.casefold().count(query.strip().casefold()))
                    if _score(query, text[:180]) >= 4: score += 2
                    if any(t['source_id'] == source['id'] and i in t['pdf_pages'] for t in curated): score += 8
                    if exact_signature and exact_signature['source_id'] == source['id'] and i in exact_signature['pdf_pages']: score += 20
                if score: best.append((score, i, text))
            # At most one short excerpt per source; other matches remain page links.
            for rank, (_, page, text) in enumerate(sorted(best, key=lambda x: (-x[0], x[1]))[:limit]):
                hit = re.search(re.escape(query.strip()), text, re.I)
                start = hit.start() if hit else 0
                excerpt = ' '.join(text[start:].split()[:20])[:150] if rank == 0 else None
                pages.append({'source_id': source['id'], 'pdf_page': page, 'excerpt': excerpt,
                              'citation': citation(source['id'], [page], 'PDF search result')})
        except (OSError, ValueError, KeyError) as exc:
            unavailable.append({'source_id': source['id'], 'reason': str(exc)})
    return {'query': query, 'topics': curated, 'pages': pages, 'unavailable_indexes': unavailable,
            'note': 'PDF pages are physical 1-based pages, which can differ from printed labels. Historical references do not establish installed-version compatibility.'}


def signature(name):
    match = next((v for k, v in catalog()['signatures'].items() if k.casefold() == name.casefold()), None)
    if match is None: return None
    return {**match, 'citation': citation(match['source_id'], match['pdf_pages'], match['section'])}


def _atomic(path, data):
    temp = path.with_name(path.name + '.' + uuid4().hex + '.tmp')
    try:
        temp.write_bytes(data)
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def _fetch(url):
    # Only catalog URLs are passed here. Never send project data or credentials.
    with urlopen(Request(url, headers={'User-Agent': 'MotionWorksReference/0.3'}), timeout=45) as response:
        final = urlsplit(response.url)
        if final.scheme != 'https' or final.hostname != 'www.yaskawa.com':
            raise ValueError('Reference download redirected outside the official host')
        raw = response.read(MAX_DOWNLOAD + 1)
    if len(raw) > MAX_DOWNLOAD or not raw.startswith(b'%PDF'):
        raise ValueError('Official download did not return a supported PDF; it may require login')
    return raw


def sync(source_ids=None):
    data = catalog()
    sources = {s['id']: s for s in data['sources'] if s['kind'] == 'pdf'}
    ids = list(dict.fromkeys(sources if source_ids is None else source_ids))
    if any(id not in sources for id in ids): raise ValueError('Only catalog PDF source IDs can be synchronized')
    try:
        from pypdf import PdfReader
    except ImportError:
        return {'ok': False, 'error': 'PDF indexing requires pypdf in the selected plugin Python runtime. Curated search remains available.', 'sources': []}
    root = cache_root(); root.mkdir(parents=True, exist_ok=True)
    results = []
    for id in ids:
        source = sources[id]
        try:
            pdf = _safe_child(root, id + '.pdf')
            index = _safe_child(root, id + '.json')
            raw = pdf.read_bytes() if pdf.exists() else _fetch(source['url'])
            digest = hashlib.sha256(raw).hexdigest()
            if digest != source['sha256']:
                raise ValueError('Vendor PDF differs from the reviewed revision. Catalog review is required; no old page citations were applied.')
            import io
            reader = PdfReader(io.BytesIO(raw))
            if len(reader.pages) != source['pages']: raise ValueError('PDF page count differs from catalog')
            pages = [page.extract_text() or '' for page in reader.pages]
            _atomic(pdf, raw)
            text_digest = hashlib.sha256(json.dumps(pages, ensure_ascii=False).encode('utf-8')).hexdigest()
            _atomic(index, json.dumps({'sha256': digest, 'text_sha256': text_digest, 'pages': pages}, ensure_ascii=False).encode('utf-8'))
            results.append({'source_id': id, 'status': 'indexed', 'pages': len(pages), 'path': str(pdf), 'revision': source['revision']})
        except Exception as exc:
            results.append({'source_id': id, 'status': 'unavailable', 'error': str(exc)})
    return {'ok': all(r['status'] == 'indexed' for r in results), 'sources': results}


def diagnose(message):
    if not message.strip(): raise ValueError('Supply the compiler/runtime diagnostic text')
    patterns = [
        (r'file error.*(?:\.vbc|src\.st1)|MSILv2ResManager|variable.*not found', 'diagnostics', 'compiler_or_native_format', ['Preserve the exact project, error text and transaction journal.', 'Compare paired VB/VGR declarations and source stream hashes with the last verified snapshot.', 'Do not patch generated cache files, replace a binary container as text, or restore underneath an open IDE.']),
        (r'division by zero|divide.by.zero', 'diagnostics', 'runtime', ['Inspect denominators and cam-generation segment lengths at the faulting operation.', 'Zero compiler errors do not exclude runtime arithmetic faults. Capture runtime values before proposing a change.']),
        (r'identity.*workspace|outside.*stag|ENOTDIR', 'diagnostics', 'workspace_state', ['Read the calling session workspace and mw_workflow_check for the explicit stage.', 'Check relocated identity paths and wrappers. Do not weaken guards or restage over unsynced source edits.']),
        (r'error\s+in\s+native\s+code\s+generation', 'native-code-error', 'compiler', ['Read the first underlying compiler diagnostic.', 'Compare IDE, controller target and library versions before changing declarations.']),
        (r'operand\s+not\s+implemented|area\s+exceeded', 'address-range', 'runtime_or_debug', ['Inspect IO_Configuration address ranges.', 'Compare the located variable address with the configured driver.']),
        (r'no\s+matching\s+global|global-not-declared-external|external.*(?:missing|mismatch)', 'scope', 'compiler', ['Compare the resource global with the POU external name and type.', 'Inspect both VB and VGR consistency; do not convert an external to a local just to hide the error.']),
        (r'type.*(?:invalid|mismatch)|incompatible.*type|cannot.*convert', 'strict-types', 'compiler', ['Read operand declarations and FB formal types.', 'Use an explicit, range-appropriate conversion where intended.']),
        (r'\b4370\b|motionprohibited', 'stop', 'runtime', ['Inspect axis state, active commands and the MC_Stop instance.', 'Do not automatically clear interlocks or reset the axis.']),
        (r'\b4625\b|axis.*(?:id|number).*not', 'axis-id', 'runtime', ['Compare the logical axis reference with Hardware Configuration.']),
        (r'watchdog|task.*overrun', 'task-priority', 'runtime', ['Inspect task timing, execution load and priority.', 'Do not mask an overrun merely by extending its watchdog.']),
        (r'completion unverified|stalled|empty.*errors', 'diagnostics', 'ide_state', ['Inspect modal dialogs and current compiler state.', 'An empty error pane is not a success verdict; never repair disk files under an open IDE.']),
    ]
    matches = [{'category': kind, 'evidence': reference(topic), 'suggested_checks': checks,
                'confidence': 'candidate_not_confirmed', 'mapping': 'plugin_authored_from_cited_guidance'}
               for pattern, topic, kind, checks in patterns if re.search(pattern, message, re.I)]
    if re.search(r'''illegal\s+IEC\s+syntax\s+at\s+or\s+before\s+['"]>['"]''',message,re.I):
        matches.append({
            'category':'compiler',
            'confidence':'candidate_not_confirmed',
            'mapping':'plugin_authored_from_live_observation_and_installed_help',
            'evidence':{'kind':'installed_help_and_live_compile',
                        'observed_ide':'MotionWorks IEC 3 Pro, automation version 1.19',
                        'installed_help':{'tool':'mw_code_installed_help','module':'ST001','topic':'callingfunctionblocksinst.htm'}},
            'suggested_checks':[
                'Read the exact offending ST line before diagnosing the token.',
                'If the line uses => for an FB output, read the installed ST FB-call topic: the tested IDE rejected that form and accepted assignments from instance output fields after the call.',
                'Resolve actual pin directions/types with mw_code_block_interface. Keep in-out bindings in the call; capture output fields afterward.',
                'A greater-than token can fail for other reasons. Confirm the source context and installed version, then use guarded code editing and fresh Build/Make; do not rewrite automatically.'
            ]})
    return {'matches': matches, 'matched': bool(matches), 'automatic_changes': False,
            'next': 'Confirm candidates against the exact diagnostic, project and installed versions.' if matches else 'No documented mapping matched. Preserve the exact message and inspect its source location; do not invent a root cause.'}


def patterns(name=None):
    data = json.loads((DATA / 'patterns.json').read_text(encoding='utf-8'))
    if name is None: return {'patterns': [{'id': p['id'], 'title': p['title']} for p in data]}
    found = next((p for p in data if p['id'] == name), None)
    if found is None: raise ValueError('Unknown pattern ID')
    return {**found, 'references': [reference(id) for id in found['topic_ids']],
            'provenance': 'Original illustrative plugin pattern; not copied vendor code',
            'validation': 'Requires project-specific adaptation and native IDE compile; no hardware action is performed'}

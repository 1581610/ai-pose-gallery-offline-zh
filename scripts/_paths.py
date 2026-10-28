"""Portable paths. Source metadata retains the original author's img/thumbs names."""
from pathlib import Path, PurePosixPath

ROOT = str(Path(__file__).resolve().parents[1])
DATA = str(Path(ROOT, 'data'))
GAL = ROOT
DOC = str(Path(ROOT, 'docs'))
TOOL = str(Path(ROOT, 'scripts'))
AUDIT = str(Path(ROOT, 'tests'))
SHOTS = str(Path(AUDIT, 'artifacts'))


def validate_asset(rel):
    if not isinstance(rel, str):
        raise ValueError('Image path must be a string')
    path = PurePosixPath(rel)
    if (path.is_absolute() or '..' in path.parts or not path.parts
            or path.parts[0] not in ('img', 'thumbs')
            or ':' in rel or '\\' in rel
            or path.suffix.lower() not in ('.png', '.jpg', '.jpeg', '.webp')):
        raise ValueError(f'Unsafe image path: {rel}')
    return path


def asset_relative(rel):
    path = PurePosixPath(str(rel).replace('\\', '/'))
    if path.parts and path.parts[0] in ('img', 'thumbs'):
        folder = 'images' if path.parts[0] == 'img' else 'thumbnails'
        return str(PurePosixPath('assets', folder, *path.parts[1:]))
    return str(path)


def P(*parts):
    return str(Path(DATA, *parts))


def G(*parts):
    if not parts:
        return ROOT
    path = PurePosixPath(*(str(x).replace('\\', '/') for x in parts))
    if path.parts[:2] == ('归档', '原图'):
        result = Path(ROOT, '.archive', 'originals', *path.parts[2:])
    elif str(path) == 'gallery.html':
        result = Path(ROOT, 'index.html')
    else:
        result = Path(ROOT, asset_relative(str(path)))
    if not result.resolve().is_relative_to(Path(ROOT)):
        raise ValueError(f'Path escapes project: {path}')
    return str(result)


def D(*parts):
    return str(Path(DOC, *parts))


def file_url(path):
    return Path(path).resolve().as_uri()

# import http.server
import watchdog
from os import scandir
from pathlib import Path
import subprocess
from shutil import copy2

def output_path(path):
    output = Path(BUILD_PATH / path)
    if path.suffix == '.md':
        output = output.parent / (output.stem + '.html')
    return output

BUILD_PATH = Path('./build')
def traverse_dir():
    to_search = [Path('.')]
    while len(to_search) > 0:
        cd = to_search.pop()
        for entry in scandir(cd):
            path = cd / entry.name
            if entry.is_file(follow_symlinks=True):
                yield path
            elif path != BUILD_PATH:
                to_search.append(path)
    
def handle_file(path):
    output = output_path(path)
    if output.exists() and path.stat().st_mtime <= output.stat().st_mtime:
        return
    print(f'{path} -> {output}')
    output.parent.mkdir(parents=True, exist_ok=True)
    if path.suffix == '.md':
        subprocess.run(['pandoc', '-s', str(path), '-o', str(output)], check=True)
    else:
        copy2(path, output)

def init_build():
    for path in traverse_dir():
        handle_file(path)

if __name__ == '__main__':
    init_build()

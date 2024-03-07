import subprocess
import sys

deps = [
    'numpy~=1.24.4',
    'sentencepiece~=0.1.98',
    'transformers>=4.35.2,<5.0.0',
    'gguf>=0.1.0',
    'protobuf>=4.21.0,<5.0.0',
    'torch~=2.1.1',
    'packaging>=20.0',
    'tiktoken~=0.5.0'
]
subprocess.check_call([sys.executable, '-m', 'pip', 'install', '--upgrade', '--force-reinstall', *deps])

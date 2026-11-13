#!/usr/bin/env python3
"""Create private local credentials once; never replace an existing environment."""
import os
from pathlib import Path
import secrets


def initialize(root: Path) -> bool:
    target = root / '.env'
    try:
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        return False
    with os.fdopen(fd, 'w', encoding='utf-8') as output:
        for key in ('ORACLE_PASSWORD', 'ORACLE_APP_PASSWORD', 'POSTGRES_PASSWORD'):
            # Hex avoids connection-string, SQLPlus and dotenv delimiter escaping.
            output.write(f'{key}={secrets.token_hex(24)}\n')
        output.write('WAFERSCOPE_BIND_ADDRESS=127.0.0.1\n')
    return True


if __name__ == '__main__':
    created = initialize(Path(__file__).resolve().parents[1])
    print('Created .env with private credentials (mode 600).' if created
          else 'Existing .env preserved; no credentials changed.')

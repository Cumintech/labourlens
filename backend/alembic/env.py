import sys
from logging.config import fileConfig
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy import pool

from alembic import context

# So `import models`/`import database` below resolve the same way they
# do everywhere else in this backend, regardless of the cwd alembic is
# invoked from.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import models  # noqa: E402 -- populates Base.metadata as a side effect; unused directly
import database  # noqa: E402

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# The one source of truth for both schema and connection string is
# models.py/database.py, not a separately maintained alembic.ini value
# -- reusing database.DATABASE_URL (already loaded from the real env
# var in prod / .env in local dev, exactly like every verify_*.py
# script) guarantees alembic always points at the same database the
# app itself would.
#
# Deliberately NOT going through config.set_main_option()/
# engine_from_config() here: those round-trip the URL through Python's
# ConfigParser, which treats "%" as interpolation syntax and raises on
# any URL-encoded password containing one (e.g. a literal "%" encoded
# as "%25") -- a real failure hit with a real Supabase password.
# Building the engine directly from database.DATABASE_URL sidesteps
# ConfigParser entirely, so any valid DB URL works regardless of what
# characters the password contains.

target_metadata = database.Base.metadata

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    context.configure(
        url=database.DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    connectable = create_engine(database.DATABASE_URL, poolclass=pool.NullPool)

    with connectable.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()

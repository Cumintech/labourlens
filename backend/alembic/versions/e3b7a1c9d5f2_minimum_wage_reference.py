"""minimum wage reference tables (Basic and DA versioned separately)

Revision ID: e3b7a1c9d5f2
Revises: d2e9f5a8b3c1
Create Date: 2026-11-07 00:00:00.000000

Seeds Tamil Nadu Rice/Flour/Dhall Mills (33 classes). DA 292.80/day is
effective 2026-04-01 and flagged unverified. Run `alembic upgrade head`
manually (Render does not).
"""
from datetime import date
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'e3b7a1c9d5f2'
down_revision: Union[str, Sequence[str], None] = 'd2e9f5a8b3c1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Frozen snapshot of the seed (do not import app code into a migration).
CLASSES = [
    (1, 'Hamalis (Bag Carriers)', 'daily', 270.5),
    (2, 'Bag Weighter of Katta Mazdoors', 'daily', 267),
    (3, 'Bag Stitchers', 'daily', 267),
    (4, 'Carriers of husk', 'daily', 261),
    (5, 'Mazdoors including miscellaneous workers', 'daily', 261),
    (6, 'Carriers of Rice', 'daily', 261),
    (7, 'Engine Driver', 'daily', 279),
    (8, 'Electrician', 'daily', 279),
    (9, 'Fireman', 'daily', 262),
    (10, 'Fitter', 'daily', 267),
    (11, 'Hullerman', 'daily', 262),
    (12, 'Maistries', 'daily', 270.5),
    (13, 'Mechanic', 'daily', 270.5),
    (14, 'Oilers', 'daily', 261),
    (15, 'Paddy Boilers', 'daily', 267),
    (16, 'Paddy Drivers', 'daily', 261),
    (17, 'Paddy Millers', 'daily', 261),
    (18, 'Sweepers', 'daily', 261),
    (19, 'Shellerman', 'daily', 261),
    (20, 'Winnowers', 'daily', 261),
    (21, 'Paddy Soakers', 'daily', 261),
    (22, 'Water Carriers', 'daily', 261),
    (23, 'Watchman', 'daily', 261),
    (24, 'Mazdoors employed in polishing', 'daily', 261),
    (25, 'Rice Measures', 'daily', 262),
    (26, 'Mazdoors employed in grinding grain', 'daily', 261),
    (27, 'Dhall Manufacturers', 'daily', 261),
    (28, 'Loadman', 'daily', 261),
    (29, 'Peons', 'daily', 261),
    (30, 'Carpenters', 'daily', 267),
    (31, 'Varukadalai Workers', 'daily', 270.5),
    (32, 'Clerk', 'monthly', 7632),
    (33, 'Attenders', 'monthly', 7363),
]

NEW_TABLES = [
    "minimum_wage_employments", "minimum_wage_classes",
    "minimum_wage_basic_versions", "minimum_wage_da_versions",
]


def upgrade() -> None:
    op.create_table(
        'minimum_wage_employments',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('code', sa.String(), nullable=False, unique=True),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('jurisdiction', sa.String(), nullable=False),
        sa.Column('da_unit', sa.String(), nullable=False, server_default='daily'),
        sa.Column('da_days_per_month', sa.Integer(), nullable=False, server_default='30'),
        sa.Column('monthly_to_daily_divisor', sa.Integer(), nullable=False, server_default='26'),
        sa.Column('da_revision_note', sa.String(), nullable=True),
    )
    op.create_table(
        'minimum_wage_classes',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('employment_id', sa.Integer(), sa.ForeignKey('minimum_wage_employments.id'), nullable=False),
        sa.Column('sl_no', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('rate_type', sa.String(), nullable=False),
        sa.UniqueConstraint('employment_id', 'name', name='uq_min_wage_class_name'),
    )
    op.create_index('ix_minimum_wage_classes_employment_id', 'minimum_wage_classes', ['employment_id'])
    op.create_table(
        'minimum_wage_basic_versions',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('class_id', sa.Integer(), sa.ForeignKey('minimum_wage_classes.id'), nullable=False),
        sa.Column('basic', sa.Float(), nullable=False),
        sa.Column('effective_from', sa.Date(), nullable=False),
        sa.Column('source', sa.String(), nullable=True),
    )
    op.create_index('ix_minimum_wage_basic_versions_class_id', 'minimum_wage_basic_versions', ['class_id'])
    op.create_table(
        'minimum_wage_da_versions',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('employment_id', sa.Integer(), sa.ForeignKey('minimum_wage_employments.id'), nullable=False),
        sa.Column('da_value', sa.Float(), nullable=False),
        sa.Column('effective_from', sa.Date(), nullable=False),
        sa.Column('verified', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('source', sa.String(), nullable=True),
    )
    op.create_index('ix_minimum_wage_da_versions_employment_id', 'minimum_wage_da_versions', ['employment_id'])

    with op.batch_alter_table('owners') as b:
        b.add_column(sa.Column('min_wage_employment_id', sa.Integer(), nullable=True))
        b.create_foreign_key('fk_owners_min_wage_employment', 'minimum_wage_employments', ['min_wage_employment_id'], ['id'])
    with op.batch_alter_table('workers') as b:
        b.add_column(sa.Column('min_wage_class_id', sa.Integer(), nullable=True))
        b.create_foreign_key('fk_workers_min_wage_class', 'minimum_wage_classes', ['min_wage_class_id'], ['id'])

    bind = op.get_bind()
    emp_t = sa.table('minimum_wage_employments', sa.column('id', sa.Integer), sa.column('code', sa.String),
                     sa.column('name', sa.String), sa.column('jurisdiction', sa.String),
                     sa.column('da_unit', sa.String), sa.column('da_days_per_month', sa.Integer),
                     sa.column('monthly_to_daily_divisor', sa.Integer), sa.column('da_revision_note', sa.String))
    cls_t = sa.table('minimum_wage_classes', sa.column('id', sa.Integer), sa.column('employment_id', sa.Integer),
                     sa.column('sl_no', sa.Integer), sa.column('name', sa.String), sa.column('rate_type', sa.String))
    basic_t = sa.table('minimum_wage_basic_versions', sa.column('class_id', sa.Integer), sa.column('basic', sa.Float),
                       sa.column('effective_from', sa.Date), sa.column('source', sa.String))
    da_t = sa.table('minimum_wage_da_versions', sa.column('employment_id', sa.Integer), sa.column('da_value', sa.Float),
                    sa.column('effective_from', sa.Date), sa.column('verified', sa.Boolean), sa.column('source', sa.String))
    op.bulk_insert(emp_t, [{'id': 1, 'code': 'tn_rice_flour_dhall_mills', 'name': 'Rice Mills, Flour Mills or Dhall Mills',
                            'jurisdiction': 'Tamil Nadu', 'da_unit': 'daily', 'da_days_per_month': 30,
                            'monthly_to_daily_divisor': 26, 'da_revision_note': 'Revised every 1 April'}])
    op.bulk_insert(da_t, [{'employment_id': 1, 'da_value': 292.80, 'effective_from': date(2026, 4, 1),
                           'verified': False, 'source': 'Current DA per day; subject to official verification'}])
    op.bulk_insert(cls_t, [{'id': sl, 'employment_id': 1, 'sl_no': sl, 'name': n, 'rate_type': r} for sl, n, r, _ in CLASSES])
    op.bulk_insert(basic_t, [{'class_id': sl, 'basic': b, 'effective_from': date(2000, 1, 1), 'source': 'Original GO'}
                             for sl, _, _, b in CLASSES])
    if bind.dialect.name == "postgresql":
        # explicit ids above: move the sequences past them
        op.execute("SELECT setval(pg_get_serial_sequence('minimum_wage_employments','id'), 1)")
        op.execute("SELECT setval(pg_get_serial_sequence('minimum_wage_classes','id'), 33)")

    if bind.dialect.name == "postgresql":
        for t in NEW_TABLES:
            op.execute(f'ALTER TABLE "{t}" ENABLE ROW LEVEL SECURITY;')


def downgrade() -> None:
    with op.batch_alter_table('workers') as b:
        b.drop_constraint('fk_workers_min_wage_class', type_='foreignkey')
        b.drop_column('min_wage_class_id')
    with op.batch_alter_table('owners') as b:
        b.drop_constraint('fk_owners_min_wage_employment', type_='foreignkey')
        b.drop_column('min_wage_employment_id')
    for t in reversed(NEW_TABLES):
        op.drop_table(t)

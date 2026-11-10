"""Brick and Tiles Manufacturing + worker types linked to minimum-wage classes

Revision ID: a5d7c9e1f3b2
Revises: f4c8b2d6a1e3
Create Date: 2026-11-10 00:00:00.000000

Adds: class group/unit, DA valid-to, worker_types.min_wage_class_id; the Rice Mill's
2025-26 DA (291.20); and the Brick and Tiles Manufacturing employment (73 classes,
DA 236.60 for 2025-26). All additive: nothing existing is edited except filling the
new "unit" on the existing rice classes. Run `alembic upgrade head` manually (Render
does not).
"""
from datetime import date
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'a5d7c9e1f3b2'
down_revision: Union[str, Sequence[str], None] = 'f4c8b2d6a1e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Frozen snapshot of the seed (do not import app code into a migration).
# (id, sl_no, group, name, rate_type, unit, basic, note)
BRICK_CLASSES = [
    (34, 1, 'Group I - Skilled', 'Blacksmiths', 'monthly', 'month', 6411, None),
    (35, 2, 'Group I - Skilled', 'Carpenters', 'monthly', 'month', 6411, None),
    (36, 3, 'Group I - Skilled', 'Fitters', 'monthly', 'month', 6501, None),
    (37, 4, 'Group I - Skilled', 'Electricians', 'monthly', 'month', 6501, None),
    (38, 5, 'Group I - Skilled', 'Mechanic', 'monthly', 'month', 6411, None),
    (39, 6, 'Group I - Skilled', 'Masons', 'monthly', 'month', 6411, None),
    (40, 7, 'Group I - Skilled', 'Operators', 'monthly', 'month', 6411, None),
    (41, 8, 'Group I - Skilled', 'Engine Drivers', 'monthly', 'month', 6411, None),
    (42, 9, 'Group I - Skilled', 'Welders', 'monthly', 'month', 6411, None),
    (43, 10, 'Group I - Skilled', 'Die Makers', 'monthly', 'month', 6501, None),
    (44, 11, 'Group II - Grade I', 'Mould Helpers', 'daily', 'day', 225, None),
    (45, 12, 'Group II - Grade I', 'Press man', 'daily', 'day', 225, None),
    (46, 13, 'Group II - Grade I', 'Brick makers or Tile makers', 'daily', 'day', 225, None),
    (47, 14, 'Group II - Grade I', 'Die pullers', 'daily', 'day', 225, None),
    (48, 15, 'Group II - Grade I', 'Clay slicers and Transpiers', 'daily', 'day', 225, None),
    (49, 16, 'Group II - Grade I', 'Clay mixers', 'daily', 'day', 225, None),
    (50, 17, 'Group II - Grade I', 'Kiln loaders and un-loaders', 'daily', 'day', 225, None),
    (51, 18, 'Group II - Grade I', 'Burnt goods sorters and packers (including stacking)', 'daily', 'day', 225, None),
    (52, 19, 'Group II - Grade I', 'Wheel turners', 'daily', 'day', 225, None),
    (53, 20, 'Group II - Grade I', 'Tile trimmers', 'daily', 'day', 225, None),
    (54, 21, 'Group II - Grade I', 'Artificial drying fire attenders', 'daily', 'day', 225, None),
    (55, 22, 'Group II - Grade I', 'Kiln burners', 'daily', 'day', 225, None),
    (56, 23, 'Group II - Grade I', 'Security guard or watchman', 'daily', 'day', 225, None),
    (57, 24, 'Group III - Grade II', 'Material handling workers', 'daily', 'day', 215, None),
    (58, 25, 'Group III - Grade II', 'Material carriers', 'daily', 'day', 215, None),
    (59, 26, 'Group III - Grade II', 'Helpers', 'daily', 'day', 215, None),
    (60, 27, 'Group III - Grade II', 'Tile carriers', 'daily', 'day', 215, None),
    (61, 28, 'Group III - Grade II', 'Fuel carriers', 'daily', 'day', 215, None),
    (62, 29, 'Group III - Grade II', 'Clay transporters and carriers', 'daily', 'day', 215, None),
    (63, 30, 'Group III - Grade II', 'Loading, unloading helpers', 'daily', 'day', 215, None),
    (64, 31, 'Group III - Grade II', 'Slab cutters and slab carriers', 'daily', 'day', 215, None),
    (65, 32, 'Group III - Grade II', 'Clay feeders', 'daily', 'day', 215, None),
    (66, 33, 'Group III - Grade II', 'General coolies', 'daily', 'day', 215, None),
    (67, 34, 'Group III - Grade II', 'Slab placers', 'daily', 'day', 215, None),
    (68, 35, 'Group III - Grade II', 'Sweepers', 'daily', 'day', 215, None),
    (69, 36, 'Group III - Grade II', 'Raw tiles removers from frame', 'daily', 'day', 215, None),
    (70, 37, 'Group III - Grade II', 'Raw bricks and tile carriers', 'daily', 'day', 215, None),
    (71, 38, 'Group III - Grade II', 'Pallet suppliers', 'daily', 'day', 215, None),
    (72, 39, 'Group III - Grade II', 'Pallet collectors', 'daily', 'day', 215, None),
    (73, 40, 'Group III - Grade II', 'Water carriers', 'daily', 'day', 215, None),
    (74, 41, 'Group III - Grade II', 'Sand and cement mixers (Mosaic)', 'daily', 'day', 215, None),
    (75, 42, 'Group III - Grade II', 'Head load workers (Mosaic)', 'daily', 'day', 215, None),
    (76, 43, 'Group III - Grade II', 'Sand suppliers (Mosaic)', 'daily', 'day', 215, None),
    (77, 44, 'Group III - Grade II', 'Tile plasters (Mosaic)', 'daily', 'day', 215, None),
    (78, 45, 'Group III - Grade II', 'Box removers (Mosaic)', 'daily', 'day', 215, None),
    (79, 46, 'Group III - Grade II', 'Colour mixers (Mosaic)', 'daily', 'day', 215, None),
    (80, 47, 'Group III - Grade II', 'Chips screeners (Mosaic)', 'daily', 'day', 215, None),
    (81, 48, 'Group III - Grade II', 'Other workers not specified in Groups I, II and IV', 'daily', 'day', 215, None),
    (82, 49, 'Group IV - Staff', 'Foreman', 'monthly', 'month', 7426, None),
    (83, 50, 'Group IV - Staff', 'Technical Supervisor', 'monthly', 'month', 7064, None),
    (84, 51, 'Group IV - Staff', 'Supervisor', 'monthly', 'month', 6689, None),
    (85, 52, 'Group IV - Staff', 'Clerk', 'monthly', 'month', 6596, None),
    (86, 53, 'Group IV - Staff', 'Accountant', 'monthly', 'month', 7064, None),
    (87, 54, 'Group IV - Staff', 'Store keeper', 'monthly', 'month', 6689, None),
    (88, 55, 'Group IV - Staff', 'Office boy', 'monthly', 'month', 6047, None),
    (89, 56, 'Group IV - Staff', 'Maistry', 'monthly', 'month', 6596, None),
    (90, 57, 'Group IV - Staff', 'Maistry with more than 12 years of service as Maistry', 'monthly', 'month', 6759, None),
    (91, 58, 'Mosaic Tiles Manufacturing', 'Tile makers (Mosaic)', 'daily', 'day', 259, None),
    (92, 59, 'Mosaic Tiles Manufacturing', 'Mixer (Mosaic)', 'daily', 'day', 225, 'Plus a mixing allowance of Rs 32.50/day -- not part of the minimum'),
    (93, 60, 'Mosaic Tiles Manufacturing', 'Helper (Mosaic)', 'daily', 'day', 225, None),
    (94, 61, 'Mosaic Tiles Manufacturing', 'Cement tiles pressers (Mosaic)', 'daily', 'day', 225, None),
    (95, 62, 'Mosaic Tiles Manufacturing', 'Mould operators (Mosaic)', 'daily', 'day', 225, None),
    (96, 63, 'Brick Manufacturing (piece rate / special)', 'Chamber bricks', 'piece', '1,000 bricks', 610.39, None),
    (97, 64, 'Brick Manufacturing (piece rate / special)', 'Country bricks', 'piece', '1,000 bricks', 457.98, None),
    (98, 65, 'Brick Manufacturing (piece rate / special)', 'Transporting bricks in kiln', 'piece', '1,000 bricks', 306.71, None),
    (99, 66, 'Brick Manufacturing (piece rate / special)', 'Table mould bricks', 'piece', '1,000 bricks', 763.74, None),
    (100, 67, 'Brick Manufacturing (piece rate / special)', 'Loading and unloading from kiln', 'piece', '1,000 bricks', 76.76, None),
    (101, 68, 'Brick Manufacturing (piece rate / special)', 'Bringing sand to kiln spread/chamber', 'piece', 'unit not confirmed', 182.01, 'Unit unclear in the notification as supplied -- verify'),
    (102, 69, 'Brick Manufacturing (piece rate / special)', 'Bringing firewood or coal', 'piece', 'ton', 155.73, None),
    (103, 70, 'Brick Manufacturing (piece rate / special)', 'Fireman, kiln', 'daily', 'day', 243, None),
    (104, 71, 'Brick Manufacturing (piece rate / special)', 'Cutting and arranging table mould bricks', 'piece', '1,000 bricks', 766.39, None),
    (105, 72, 'Brick Manufacturing (piece rate / special)', 'Chamber bricks (item 8c)', 'piece', '1,000 bricks', 610.39, 'Listed a second time in the notification as supplied -- verify'),
    (106, 73, 'Brick Manufacturing (piece rate / special)', 'Standard bricks 9 x 4.5 x 3 in, fetched within 100 feet', 'piece', '1,000 bricks', 457.96, 'Beyond 100 feet: by mutual agreement'),
]


def upgrade() -> None:
    with op.batch_alter_table('minimum_wage_classes') as b:
        b.add_column(sa.Column('group_name', sa.String(), nullable=True))
        b.add_column(sa.Column('unit', sa.String(), nullable=True))
    with op.batch_alter_table('minimum_wage_da_versions') as b:
        b.add_column(sa.Column('valid_to', sa.Date(), nullable=True))
    with op.batch_alter_table('worker_types') as b:
        b.add_column(sa.Column('min_wage_class_id', sa.Integer(), nullable=True))
        b.create_foreign_key('fk_worker_types_min_wage_class', 'minimum_wage_classes', ['min_wage_class_id'], ['id'])

    op.execute("UPDATE minimum_wage_classes SET unit = CASE rate_type WHEN 'monthly' THEN 'month' ELSE 'day' END WHERE employment_id = 1")

    emp_t = sa.table('minimum_wage_employments', sa.column('id', sa.Integer), sa.column('code', sa.String),
                     sa.column('name', sa.String), sa.column('jurisdiction', sa.String), sa.column('da_unit', sa.String),
                     sa.column('da_days_per_month', sa.Integer), sa.column('monthly_to_daily_divisor', sa.Integer),
                     sa.column('da_revision_note', sa.String))
    da_t = sa.table('minimum_wage_da_versions', sa.column('employment_id', sa.Integer), sa.column('da_value', sa.Float),
                    sa.column('effective_from', sa.Date), sa.column('valid_to', sa.Date), sa.column('verified', sa.Boolean),
                    sa.column('source', sa.String))
    cls_t = sa.table('minimum_wage_classes', sa.column('id', sa.Integer), sa.column('employment_id', sa.Integer),
                     sa.column('sl_no', sa.Integer), sa.column('name', sa.String), sa.column('rate_type', sa.String),
                     sa.column('group_name', sa.String), sa.column('unit', sa.String))
    basic_t = sa.table('minimum_wage_basic_versions', sa.column('class_id', sa.Integer), sa.column('basic', sa.Float),
                       sa.column('effective_from', sa.Date), sa.column('source', sa.String))

    # Rice Mills: the 2025-26 DA, so earlier months can be checked too
    op.bulk_insert(da_t, [{'employment_id': 1, 'da_value': 291.20, 'effective_from': date(2025, 4, 1),
                           'valid_to': date(2026, 3, 31), 'verified': True,
                           'source': 'Notification 2025-26 (supplied by owner)'}])
    # Brick and Tiles Manufacturing
    op.bulk_insert(emp_t, [{'id': 2, 'code': 'tn_brick_tiles', 'name': 'Brick and Tiles Manufacturing',
                            'jurisdiction': 'Tamil Nadu', 'da_unit': 'daily', 'da_days_per_month': 30,
                            'monthly_to_daily_divisor': 26, 'da_revision_note': 'Revised every 1 April'}])
    op.bulk_insert(da_t, [{'employment_id': 2, 'da_value': 236.60, 'effective_from': date(2025, 4, 1),
                           'valid_to': date(2026, 3, 31), 'verified': True,
                           'source': 'Notification 2025-26: variable DA Rs 236.60/day (supplied by owner)'}])
    op.bulk_insert(cls_t, [{'id': i, 'employment_id': 2, 'sl_no': sl, 'name': n, 'rate_type': rt, 'group_name': g, 'unit': u}
                           for i, sl, g, n, rt, u, _b, _note in BRICK_CLASSES])
    op.bulk_insert(basic_t, [{'class_id': i, 'basic': b, 'effective_from': date(2000, 1, 1), 'source': note or 'Original GO'}
                             for i, _sl, _g, _n, _rt, _u, b, note in BRICK_CLASSES])
    if op.get_bind().dialect.name == "postgresql":
        # explicit ids above: move the sequences past them
        op.execute("SELECT setval(pg_get_serial_sequence('minimum_wage_employments','id'), 2)")
        op.execute("SELECT setval(pg_get_serial_sequence('minimum_wage_classes','id'), 106)")


def downgrade() -> None:
    # Worker types linked to classes would block deleting the classes: unlink first
    op.execute("UPDATE worker_types SET min_wage_class_id = NULL")
    op.execute("UPDATE workers SET min_wage_class_id = NULL WHERE min_wage_class_id > 33")
    op.execute("UPDATE owners SET min_wage_employment_id = NULL WHERE min_wage_employment_id = 2")
    op.execute("DELETE FROM minimum_wage_basic_versions WHERE class_id > 33")
    op.execute("DELETE FROM minimum_wage_classes WHERE id > 33")
    op.execute("DELETE FROM minimum_wage_da_versions WHERE employment_id = 2 OR effective_from = '2025-04-01'")
    op.execute("DELETE FROM minimum_wage_employments WHERE id = 2")
    with op.batch_alter_table('worker_types') as b:
        b.drop_constraint('fk_worker_types_min_wage_class', type_='foreignkey')
        b.drop_column('min_wage_class_id')
    with op.batch_alter_table('minimum_wage_da_versions') as b:
        b.drop_column('valid_to')
    with op.batch_alter_table('minimum_wage_classes') as b:
        b.drop_column('unit')
        b.drop_column('group_name')

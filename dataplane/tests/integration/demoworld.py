"""Backend-owned demo rows for integration tests.

Stand-in for the backend demo seeder (``Demo__SeedOnStartup=true``) using the
fixed UUIDs from ``shared/contracts/demo-seed.md``. These writes happen only
in dev-DB test fixtures — runtime dataplane code never writes backend-owned
tables.
"""

from sqlalchemy import text
from sqlalchemy.orm import Session

BACKEND_DEMO_ROWS_SQL = [
    """
    INSERT INTO tenants (id, name, subscription_plan, subscription_status, created_at)
    VALUES ('11111111-1111-4111-8111-111111111111', 'Pensiunea Demo SRL', 'demo', 'active', now())
    ON CONFLICT (id) DO NOTHING
    """,
    """
    INSERT INTO properties (id, tenant_id, name, city, address, created_at)
    VALUES ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111',
            'Pensiunea Piața Mică', 'sibiu', NULL, now())
    ON CONFLICT (id) DO NOTHING
    """,
    """
    INSERT INTO room_types
        (id, tenant_id, property_id, name, capacity, base_price, current_price, currency)
    VALUES
        ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111',
         '33333333-3333-4333-8333-333333333333', 'Cameră dublă', 2, 350.00, 350.00, 'RON'),
        ('55555555-5555-4555-8555-555555555555', '11111111-1111-4111-8111-111111111111',
         '33333333-3333-4333-8333-333333333333', 'Apartament', 4, 520.00, 520.00, 'RON')
    ON CONFLICT (id) DO NOTHING
    """,
    """
    INSERT INTO competitors (id, tenant_id, property_id, name, source_url, created_at)
    VALUES
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111',
         '33333333-3333-4333-8333-333333333333', 'Hotel Ramada Sibiu',
         'https://example.test/ramada-sibiu', now()),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111',
         '33333333-3333-4333-8333-333333333333', 'Hotel Împăratul Romanilor',
         'https://example.test/imparatul-romanilor', now()),
        ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '11111111-1111-4111-8111-111111111111',
         '33333333-3333-4333-8333-333333333333', 'Casa Luxemburg',
         'https://example.test/casa-luxemburg', now())
    ON CONFLICT (id) DO NOTHING
    """,
]


def insert_backend_demo_rows(session: Session) -> None:
    """Idempotently insert the fixed backend-owned demo world."""
    for statement in BACKEND_DEMO_ROWS_SQL:
        session.execute(text(statement))

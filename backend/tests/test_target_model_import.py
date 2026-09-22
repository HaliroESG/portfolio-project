from __future__ import annotations

from copy import deepcopy

from openpyxl import Workbook, load_workbook

from scripts.import_target_model import parse_target_model, run_import


class _Response:
    def __init__(self, data=None):
        self.data = data or []


class _Table:
    def __init__(self, client, name: str):
        self.client = client
        self.name = name
        self.operation = None
        self.payload = None
        self.filters = {}
        self.on_conflict = None

    def upsert(self, payload, on_conflict):
        self.operation = "upsert"
        self.payload = payload
        self.on_conflict = on_conflict
        return self

    def delete(self):
        self.operation = "delete"
        return self

    def insert(self, payload):
        self.operation = "insert"
        self.payload = payload
        return self

    def eq(self, column, value):
        self.filters[column] = value
        return self

    def execute(self):
        rows = self.client.rows.setdefault(self.name, [])
        if self.operation == "upsert":
            key = self.on_conflict
            existing = next((row for row in rows if row.get(key) == self.payload.get(key)), None)
            if existing:
                existing.update(self.payload)
                return _Response([existing])
            rows.append(self.payload.copy())
            return _Response([self.payload.copy()])
        if self.operation == "delete":
            self.client.rows[self.name] = [
                row for row in rows
                if any(row.get(column) != value for column, value in self.filters.items())
            ]
            return _Response([])
        if self.operation == "insert":
            payloads = self.payload if isinstance(self.payload, list) else [self.payload]
            rows.extend(payload.copy() for payload in payloads)
            return _Response(payloads)
        return _Response([])


class _Supabase:
    def __init__(self, *, fail_rpc: bool = False):
        self.rows = {}
        self.fail_rpc = fail_rpc
        self.rpc_calls = []

    def table(self, name):
        return _Table(self, name)

    def rpc(self, name, params):
        self.rpc_calls.append((name, deepcopy(params)))
        return _Rpc(self, name, params)


class _Rpc:
    def __init__(self, client, name, params):
        self.client = client
        self.name = name
        self.params = params

    def execute(self):
        if self.client.fail_rpc:
            raise RuntimeError("injected RPC failure")

        next_rows = deepcopy(self.client.rows)
        model = deepcopy(self.params["p_model"])
        model_id = model["id"]
        models = next_rows.setdefault("target_models", [])
        existing = next((row for row in models if row.get("id") == model_id), None)
        if existing:
            existing.update(model)
        else:
            models.append(model)

        table_params = {
            "target_buckets": "p_buckets",
            "target_sleeve_allocations": "p_sleeve_allocations",
            "target_envelope_lines": "p_envelope_lines",
            "target_model_audit_holdings": "p_audit_holdings",
        }
        for table, parameter in table_params.items():
            retained = [row for row in next_rows.get(table, []) if row.get("model_id") != model_id]
            next_rows[table] = retained + deepcopy(self.params[parameter])

        self.client.rows = next_rows
        return _Response({"model_upserted": model_id})


def _write_personal(path):
    workbook = Workbook()
    ws = workbook.active
    ws.title = "Strategic_Target_Perso"
    ws.append(["Bucket", "Target %", "Lower Band %", "Upper Band %"])
    ws.append(["Actions US", 0.43, 0.35, 0.50])
    ws.append(["Actions Europe", 0.15, 0.10, 0.20])
    ws.append(["Actions Japon", 0.10, 0.07, 0.13])
    ws.append(["Actions Pacifique ex-JP", 0.05, 0.02, 0.08])
    ws.append(["Actions Emergents", 0.15, 0.10, 0.20])
    ws.append(["Or", 0.05, 0.03, 0.08])
    ws.append(["Obligations / Cash", 0.05, 0.03, 0.10])
    ws.append(["Crypto", 0.02, 0, 0.04])

    ws = workbook.create_sheet("Envelope_Targets")
    ws.append(["Envelope-level targets"])
    ws.append([])
    ws.append([])
    ws.append(["Envelope", "ISIN/Ticker", "Instrument", "Target % (within envelope)", "Target Value (EUR)", "Notes"])
    ws.append(["Cardif_Lucya_PostArb", "LU0496786574", "Amundi Core S&P 500 Swap ETF", 0.56, 5652.17, "core"])
    ws.append(["Fortuneo_CTO", None, None, None, None, "Optional"])

    ws = workbook.create_sheet("Holdings_All")
    ws.append(["Envelope", "ISIN/Ticker", "Instrument", "Asset_Class", "Region", "Currency", "Market_Value_EUR"])
    ws.append(["Fortuneo_PEA", "AI", "AIR LIQUIDE", "Equity", "Europe", "EUR", 8098.8])
    ws.append(["Cardif_Lucya_PostArb", "LU0496786574", "Amundi Core S&P 500 Swap ETF", "Equity", "US", "EUR", 5652.17])
    workbook.save(path)


def _write_pro(path):
    workbook = Workbook()
    ws = workbook.active
    ws.title = "Calcul_allocation_cible"
    for _ in range(25):
        ws.append([None] * 10)
    ws["E4"] = 0.1
    ws["E8"] = 0.45
    ws["E9"] = 0.2
    ws["E10"] = 0.1
    ws["E11"] = 0.05
    ws["E12"] = 0.2
    target_rows = [
        ("Actions US", "CSPX", "IE00B5BMR087"),
        ("Actions Europe", "IMAE", "IE00B4K48X80"),
        ("Actions Japon", "CJPU", "IE00B4L5YX21"),
        ("Actions Pac ex-JP", "CPXJ", "IE00B52MJY50"),
        ("Actions EM IMI", "EIMI", "IE00BKM4GZ66"),
        ("Or", "GOLD", "FR0013416716"),
    ]
    for index, values in enumerate(target_rows, start=16):
        ws.cell(row=index, column=1, value=values[0])
        ws.cell(row=index, column=2, value=values[1])
        ws.cell(row=index, column=3, value=values[2])

    ws = workbook.create_sheet("Portefeuille_cible")
    ws["B4"] = 120000

    ws = workbook.create_sheet("Modele_Core_Satellite")
    ws.append([])
    ws.append(["Recommandation Core / Satellite sur le surplus"])
    ws.append([])
    ws.append(["Bloc", "Composante", "Région", "% du surplus", "Type d’instrument", "Statut"])
    sleeve_rows = [
        ("Core", "Actions indicées", "US", 0.28, "ETF large et liquide", "À valider"),
        ("Core", "Actions indicées", "Europe", 0.12, "ETF large et liquide", "À valider"),
        ("Core", "Actions indicées", "Japon", 0.07, "ETF large et liquide", "À valider"),
        ("Core", "Actions indicées", "Pacifique hors Japon", 0.04, "ETF large et liquide", "À valider"),
        ("Core", "Actions indicées", "Marchés émergents", 0.09, "ETF large et liquide", "À valider"),
        ("Core", "Or", "Or", 0.10, "ETC or physique ou équivalent", "À valider"),
        ("Satellite", "Quality / Growth / GARP", "US", 0.13, "ETF/fonds/actions après revue", "À valider"),
        ("Satellite", "Quality / Growth / GARP", "Europe", 0.06, "ETF/fonds/actions après revue", "À valider"),
        ("Satellite", "Quality / Growth / GARP", "Japon", 0.03, "ETF/fonds/actions après revue", "À valider"),
        ("Satellite", "Quality / Growth / GARP", "Pacifique hors Japon", 0.01, "ETF/fonds/actions après revue", "À valider"),
        ("Satellite", "Quality / Growth / GARP", "Marchés émergents", 0.07, "ETF/fonds/actions après revue", "À valider"),
    ]
    for row in sleeve_rows:
        ws.append(row)

    ws = workbook.create_sheet("IBKR_Positions")
    for _ in range(4):
        ws.append([])
    ws.append(["Symbol", "Description", "Currency", "Quantity", "Price", "Market Value (ccy)", "FX to EUR", "Market Value (EUR)"])
    ws.append(["CSPX", "ISHARES CORE S&P 500", "USD", 2, 806, 1612, 0.86, 1386])
    ws.append(["TOTAL", None, None, None, None, None, None, 1386])

    ws = workbook.create_sheet("ALPHEYS")
    for _ in range(4):
        ws.append([])
    ws.append(["Instrument", "ISIN", "Qty", "Nominal", "Prix (EUR)", "Market Value"])
    ws.append(["Athena", "XS3103296227", 25, 1000, 682.7, 17067.5])
    ws.append(["TOTAL titres", None, None, None, None, 17067.5])
    workbook.save(path)


def test_personal_target_model_reads_global_and_envelope_targets(tmp_path):
    source = tmp_path / "personal.xlsx"
    _write_personal(source)

    report = parse_target_model(source, kind="perso")

    assert report["ok"] is True
    assert report["allocation_contract_version"] == "allocation_contracts_v1"
    assert report["target_total_pct"] == 100
    assert len(report["buckets"]) == 8
    crypto = next(row for row in report["buckets"] if row.bucket_key == "crypto")
    assert crypto.target_weight_pct == 2
    assert crypto.lower_band_pct == 0
    assert crypto.upper_band_pct == 4
    assert len(report["envelope_lines"]) == 1
    assert report["envelope_lines"][0].envelope == "Cardif_Lucya_PostArb"
    assert report["audit_holdings"][0].notes.startswith("audit only")


def test_personal_target_model_dry_run_rejects_each_invalid_bucket(tmp_path):
    source = tmp_path / "personal-invalid-buckets.xlsx"
    _write_personal(source)
    persisted = load_workbook(source)
    persisted["Strategic_Target_Perso"]["B2"] = 150
    persisted["Strategic_Target_Perso"]["B3"] = -92
    persisted.save(source)

    report = run_import(source, kind="perso", dry_run=True)

    assert report["target_total_pct"] == 100
    assert report["ok"] is False
    reasons = [row["reason"] for row in report["rejected"]]
    assert any("actions_us" in reason and "within 0%-100%" in reason for reason in reasons)
    assert any("actions_europe" in reason and "within 0%-100%" in reason for reason in reasons)


def test_pro_target_model_uses_calculation_sheet_authority(tmp_path):
    source = tmp_path / "pro.xlsx"
    _write_pro(source)

    report = parse_target_model(source, kind="pro")
    buckets = {row.bucket_key: row.target_weight_pct for row in report["buckets"]}

    assert report["ok"] is True
    assert buckets["gold"] == 10
    assert buckets["actions_us"] == 41
    assert buckets["actions_europe"] == 18
    assert buckets["actions_japan"] == 10
    assert buckets["actions_pacific_ex_japan"] == 5
    assert buckets["actions_emerging"] == 16
    assert report["reserve_floor_eur"] == 120000
    assert report["reserve_excluded_from_risky_allocation"] is True
    assert sum(row.target_weight_pct for row in report["sleeve_allocations"] if row.sleeve_key == "CORE") == 70
    assert sum(row.target_weight_pct for row in report["sleeve_allocations"] if row.sleeve_key == "SATELLITE") == 30


def test_target_model_apply_replaces_child_rows(tmp_path):
    source = tmp_path / "personal.xlsx"
    _write_personal(source)
    fake = _Supabase()

    report = run_import(source, kind="perso", dry_run=False, supabase_client=fake)

    assert report["ok"] is True
    assert len(fake.rpc_calls) == 1
    assert fake.rpc_calls[0][0] == "apply_target_model_v1"
    assert fake.rows["target_models"][0]["id"] == "target_model:perso:active"
    assert fake.rows["target_models"][0]["allocation_contract_version"] == "allocation_contracts_v1"
    assert len(fake.rows["target_buckets"]) == 8
    assert fake.rows["target_models"][0]["reserve_floor_eur"] is None
    assert fake.rows["target_sleeve_allocations"] == []
    assert len(fake.rows["target_envelope_lines"]) == 1
    assert len(fake.rows["target_model_audit_holdings"]) == 2


def test_pro_target_model_fails_closed_when_reserve_is_not_120k(tmp_path):
    source = tmp_path / "pro.xlsx"
    _write_pro(source)
    persisted = load_workbook(source)
    persisted["Portefeuille_cible"]["B4"] = 100000
    persisted.save(source)

    report = parse_target_model(source, kind="pro")

    assert report["ok"] is False
    assert any("reserve floor must equal EUR 120000" in row["reason"] for row in report["rejected"])


def test_pro_target_model_apply_writes_native_sleeves_and_reserve(tmp_path):
    source = tmp_path / "pro.xlsx"
    _write_pro(source)
    fake = _Supabase()

    report = run_import(source, kind="pro", dry_run=False, supabase_client=fake)

    assert report["ok"] is True
    assert len(fake.rpc_calls) == 1
    assert fake.rows["target_models"][0]["allocation_contract_version"] == "allocation_contracts_v1"
    assert fake.rows["target_models"][0]["reserve_floor_eur"] == 120000
    assert fake.rows["target_models"][0]["reserve_excluded_from_risky_allocation"] is True
    assert len(fake.rows["target_sleeve_allocations"]) == 11


def test_invalid_target_model_does_not_write(tmp_path):
    source = tmp_path / "pro.xlsx"
    _write_pro(source)
    persisted = load_workbook(source)
    persisted["Portefeuille_cible"]["B4"] = 100000
    persisted.save(source)
    fake = _Supabase()

    report = run_import(source, kind="pro", dry_run=False, supabase_client=fake)

    assert report["ok"] is False
    assert report["write"]["model_upserted"] is None
    assert fake.rows == {}
    assert fake.rpc_calls == []


def test_apply_uses_one_atomic_rpc_and_preserves_existing_rows_on_failure(tmp_path):
    source = tmp_path / "personal.xlsx"
    _write_personal(source)
    original_rows = {
        "target_models": [{"id": "target_model:perso:active", "source_file": "previous.xlsx"}],
        "target_buckets": [{"model_id": "target_model:perso:active", "bucket_key": "previous"}],
    }
    fake = _Supabase(fail_rpc=True)
    fake.rows = deepcopy(original_rows)

    try:
        run_import(source, kind="perso", dry_run=False, supabase_client=fake)
    except RuntimeError as exc:
        assert str(exc) == "injected RPC failure"
    else:
        raise AssertionError("the injected atomic RPC failure must propagate")

    assert len(fake.rpc_calls) == 1
    assert fake.rpc_calls[0][0] == "apply_target_model_v1"
    assert fake.rows == original_rows

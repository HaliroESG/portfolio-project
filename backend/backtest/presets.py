from dataclasses import dataclass


@dataclass(frozen=True)
class PresetComponent:
    ticker: str
    weight_pct: float
    proxy: str | None = None
    expected_earliest_date: str | None = None
    notes: str | None = None


@dataclass(frozen=True)
class PresetDefinition:
    key: str
    label: str
    description: str
    role: str
    expected_earliest_date: str | None
    components: tuple[PresetComponent, ...]


DEFAULT_PROXY_MAP = {
    "IWDA.L": "URTH",
    "EUNL.DE": "URTH",
    "CW8.PA": "URTH",
}


PRESETS: tuple[PresetDefinition, ...] = (
    PresetDefinition(
        key="msci_world",
        label="MSCI World Baseline",
        description=(
            "MSCI World proxy via URTH. Proxy fallback uses US total market as a "
            "long-history stand-in."
        ),
        role="baseline",
        expected_earliest_date="1992-01-01",
        components=(
            PresetComponent(
                ticker="URTH",
                weight_pct=100.0,
                proxy="VTSMX",
                expected_earliest_date="1992-01-01",
                notes="Proxy US total market (long history) before URTH inception.",
            ),
        ),
    ),
    PresetDefinition(
        key="classic_60_40",
        label="Classic 60/40",
        description="60% equity (SPY proxy) / 40% intermediate treasuries.",
        role="preset",
        expected_earliest_date="1986-01-01",
        components=(
            PresetComponent(
                ticker="SPY",
                weight_pct=60.0,
                proxy="VFINX",
                expected_earliest_date="1976-01-01",
                notes="Vanguard 500 Index Fund proxy.",
            ),
            PresetComponent(
                ticker="IEF",
                weight_pct=40.0,
                proxy="VFITX",
                expected_earliest_date="1986-01-01",
                notes="Vanguard Intermediate-Term Treasury Fund proxy.",
            ),
        ),
    ),
    PresetDefinition(
        key="all_weather",
        label="Ray Dalio All Weather",
        description=(
            "30% equity, 40% long bonds, 15% intermediate bonds, "
            "7.5% commodities, 7.5% gold."
        ),
        role="preset",
        expected_earliest_date="1986-01-01",
        components=(
            PresetComponent(
                ticker="SPY",
                weight_pct=30.0,
                proxy="VFINX",
                expected_earliest_date="1976-01-01",
            ),
            PresetComponent(
                ticker="TLT",
                weight_pct=40.0,
                proxy="VUSTX",
                expected_earliest_date="1986-01-01",
                notes="Vanguard Long-Term Treasury Fund proxy.",
            ),
            PresetComponent(
                ticker="IEF",
                weight_pct=15.0,
                proxy="VFITX",
                expected_earliest_date="1986-01-01",
            ),
            PresetComponent(
                ticker="DBC",
                weight_pct=7.5,
                proxy="^CRB",
                expected_earliest_date="1970-01-01",
                notes="CRB index proxy for commodities history.",
            ),
            PresetComponent(
                ticker="GLD",
                weight_pct=7.5,
                proxy="GC=F",
                expected_earliest_date="2000-01-01",
                notes="Gold futures proxy for pre-ETF history.",
            ),
        ),
    ),
    PresetDefinition(
        key="permanent_portfolio",
        label="Permanent Portfolio",
        description="25% stocks, 25% long bonds, 25% cash/short treasuries, 25% gold.",
        role="preset",
        expected_earliest_date="1986-01-01",
        components=(
            PresetComponent(
                ticker="SPY",
                weight_pct=25.0,
                proxy="VFINX",
                expected_earliest_date="1976-01-01",
            ),
            PresetComponent(
                ticker="TLT",
                weight_pct=25.0,
                proxy="VUSTX",
                expected_earliest_date="1986-01-01",
            ),
            PresetComponent(
                ticker="SHY",
                weight_pct=25.0,
                proxy="VFISX",
                expected_earliest_date="1991-01-01",
                notes="Vanguard Short-Term Treasury Fund proxy.",
            ),
            PresetComponent(
                ticker="GLD",
                weight_pct=25.0,
                proxy="GC=F",
                expected_earliest_date="2000-01-01",
            ),
        ),
    ),
    PresetDefinition(
        key="buffett_90_10",
        label="Buffett 90/10",
        description="90% S&P 500, 10% short treasuries.",
        role="preset",
        expected_earliest_date="1991-01-01",
        components=(
            PresetComponent(
                ticker="SPY",
                weight_pct=90.0,
                proxy="VFINX",
                expected_earliest_date="1976-01-01",
            ),
            PresetComponent(
                ticker="SHY",
                weight_pct=10.0,
                proxy="VFISX",
                expected_earliest_date="1991-01-01",
            ),
        ),
    ),
)


def list_presets() -> list[dict]:
    presets = []
    for preset in PRESETS:
        presets.append({
            "key": preset.key,
            "label": preset.label,
            "description": preset.description,
            "role": preset.role,
            "expected_earliest_date": preset.expected_earliest_date,
            "components": [
                {
                    "ticker": c.ticker,
                    "weight_pct": c.weight_pct,
                    "proxy": c.proxy,
                    "expected_earliest_date": c.expected_earliest_date,
                    "notes": c.notes,
                }
                for c in preset.components
            ],
        })
    return presets


def get_preset(key: str) -> PresetDefinition | None:
    for preset in PRESETS:
        if preset.key == key:
            return preset
    return None


def select_preset_keys(mode: str, keys: list[str] | None) -> list[str]:
    mode = (mode or "baseline").lower()
    if mode == "none":
        return []
    if mode == "all":
        return [preset.key for preset in PRESETS]
    if mode == "baseline":
        return [preset.key for preset in PRESETS if preset.role == "baseline"]
    if mode == "list":
        if not keys:
            return []
        known = {preset.key for preset in PRESETS}
        return [key for key in keys if key in known]
    return []


def build_preset_specs(keys: list[str]) -> list[dict]:
    specs = []
    for key in keys:
        preset = get_preset(key)
        if not preset:
            continue
        weights = {c.ticker: c.weight_pct for c in preset.components}
        specs.append({
            "portfolio_key": key,
            "portfolio_id": None,
            "preset_key": key,
            "label": preset.label,
            "role": preset.role,
            "weights": weights,
        })
    return specs


def get_proxy_map(keys: list[str] | None = None) -> dict[str, str]:
    proxies = dict(DEFAULT_PROXY_MAP)
    for preset in PRESETS:
        if keys is not None and preset.key not in keys:
            continue
        for component in preset.components:
            if component.proxy:
                proxies[component.ticker] = component.proxy
    return proxies


def get_preset_tickers(keys: list[str] | None = None, include_proxies: bool = False) -> set[str]:
    tickers: set[str] = set()
    for preset in PRESETS:
        if keys is not None and preset.key not in keys:
            continue
        for component in preset.components:
            tickers.add(component.ticker)
            if include_proxies and component.proxy:
                tickers.add(component.proxy)
    if include_proxies:
        tickers.update(DEFAULT_PROXY_MAP.values())
    return tickers

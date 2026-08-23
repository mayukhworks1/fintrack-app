"""
The semantic layer: what a question is allowed to ask of the finance data.

Why a query spec instead of generated SQL
─────────────────────────────────────────
The obvious way to answer "average collection period by client" is to ask a
model for SQL and sandbox the damage. That is the wrong trade here, for three
reasons that are specific to this app:

1. Row-level scoping in this codebase lives in Python, not the database. There
   is no row-level security; `invoice.py` takes a `raised_by` argument and
   filters. Any path that executes model-authored SQL bypasses that completely —
   a scoped user asks "list every invoice by value" and the generated SQL has no
   idea `auth_user_scopes` exists.
2. There is one database role and one connection pool, both with full
   privileges. A read-only role is worth adding as defence in depth, but it
   cannot be the primary control when it does not exist yet.
3. Every model in the cascade is on OpenRouter's free tier. Emitting six
   well-named JSON keys is something they do reliably; emitting correct SQL
   against a 33-table schema is not.

So the model never writes SQL. It picks from a registry — a dataset, a metric,
some dimensions, a date range — and this module compiles that to parameterised
SQL. Every table name, column and aggregate below is a literal written here.
Nothing the model returns is ever interpolated into a statement; it can only
select from what this file already contains, or be rejected.

The cost is real and worth stating: a question outside the registry cannot be
answered, and the honest response is to say so rather than improvise. For a
finance tool that is the correct failure mode.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

# Hard ceiling on returned rows. A grouped aggregate should never be large, and
# this bounds both the response and the model's reading of it.
MAX_ROWS = 200
DEFAULT_ROWS = 25


@dataclass(frozen=True)
class Metric:
    key: str
    label: str
    sql: str          # aggregate expression — a literal, never model input
    unit: str = "currency"   # currency | number | percent | days


@dataclass(frozen=True)
class Dimension:
    key: str
    label: str
    sql: str          # column expression — a literal, never model input


@dataclass(frozen=True)
class Dataset:
    key: str
    label: str
    table: str
    permission: str            # the module permission this data already sits behind
    date_column: str
    metrics: dict[str, Metric]
    dimensions: dict[str, Dimension]
    # SQL fragment scoping rows to one person, with a single $-placeholder. None
    # means the dataset has no ownership concept — see scope handling in build().
    owner_sql: str | None = None
    description: str = ""


# --- registry --------------------------------------------------------------
#
# Outstanding is computed rather than read from a column: the mirror carries
# amount_with_tax and amount_received, and deriving the difference keeps the
# metric consistent with how the rest of the app reports it.

_INVOICES = Dataset(
    key="invoices",
    label="Invoices",
    table="invoices_mirror",
    permission="module.invoices.view",
    date_column="raised_date",
    description="Invoices raised, received and outstanding, by project, category or status.",
    owner_sql="LOWER(COALESCE(fields->>'Raised By', '')) = LOWER({p})",
    metrics={
        "total_raised": Metric("total_raised", "Total raised", "COALESCE(SUM(amount_raised), 0)"),
        "total_with_tax": Metric("total_with_tax", "Total with tax", "COALESCE(SUM(amount_with_tax), 0)"),
        "total_received": Metric("total_received", "Total received", "COALESCE(SUM(amount_received), 0)"),
        "total_outstanding": Metric(
            "total_outstanding", "Outstanding",
            "COALESCE(SUM(COALESCE(amount_with_tax, 0) - COALESCE(amount_received, 0)), 0)",
        ),
        "invoice_count": Metric("invoice_count", "Number of invoices", "COUNT(*)", unit="number"),
        "avg_invoice_value": Metric(
            "avg_invoice_value", "Average invoice value",
            "COALESCE(ROUND(AVG(amount_raised), 2), 0)",
        ),
        "collection_rate": Metric(
            "collection_rate", "Collection rate",
            "CASE WHEN COALESCE(SUM(amount_with_tax), 0) = 0 THEN 0 "
            "ELSE ROUND(100 * SUM(COALESCE(amount_received, 0)) / SUM(amount_with_tax), 1) END",
            unit="percent",
        ),
        "avg_days_to_payment": Metric(
            "avg_days_to_payment", "Average days to payment",
            "COALESCE(ROUND(AVG(cleared_date - raised_date) FILTER (WHERE cleared_date IS NOT NULL)), 0)",
            unit="days",
        ),
    },
    dimensions={
        "project": Dimension("project", "Project", "COALESCE(project, 'Unassigned')"),
        "category": Dimension("category", "Category", "COALESCE(category, 'Uncategorised')"),
        "payment_status": Dimension("payment_status", "Payment status", "COALESCE(payment_status, 'Unknown')"),
        "month": Dimension("month", "Month", "TO_CHAR(DATE_TRUNC('month', raised_date), 'YYYY-MM')"),
        "quarter": Dimension("quarter", "Quarter", "TO_CHAR(DATE_TRUNC('quarter', raised_date), 'YYYY-\"Q\"Q')"),
        "raised_by": Dimension("raised_by", "Raised by", "COALESCE(fields->>'Raised By', 'Unknown')"),
    },
)

_PROJECTS = Dataset(
    key="projects",
    label="Projects",
    table="projects_mirror",
    permission="module.projects.view",
    date_column="created_time",
    description="Projects with amount billed, profit and margin, by client or status.",
    metrics={
        "total_billed": Metric("total_billed", "Total billed", "COALESCE(SUM(amount_billed), 0)"),
        "total_profit": Metric("total_profit", "Total profit", "COALESCE(SUM(actual_profit), 0)"),
        "avg_margin": Metric(
            "avg_margin", "Average margin",
            "COALESCE(ROUND(AVG(profit_pct), 2), 0)", unit="percent",
        ),
        "project_count": Metric("project_count", "Number of projects", "COUNT(*)", unit="number"),
        "avg_project_value": Metric(
            "avg_project_value", "Average project value",
            "COALESCE(ROUND(AVG(amount_billed), 2), 0)",
        ),
    },
    dimensions={
        "client": Dimension("client", "Client", "COALESCE(client, 'Unknown')"),
        "status": Dimension("status", "Status", "COALESCE(status, 'Unknown')"),
        "month": Dimension("month", "Month", "TO_CHAR(DATE_TRUNC('month', created_time), 'YYYY-MM')"),
    },
)

DATASETS: dict[str, Dataset] = {d.key: d for d in (_INVOICES, _PROJECTS)}


# --- date ranges -----------------------------------------------------------
#
# Named rather than free-form. A model that can write arbitrary date arithmetic
# is a model that can write a predicate nobody reviewed.
PERIODS: dict[str, str] = {
    "all_time": "",
    "this_month": "DATE_TRUNC('month', {col}) = DATE_TRUNC('month', CURRENT_DATE)",
    "last_month": "DATE_TRUNC('month', {col}) = DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')",
    "last_3_months": "{col} >= CURRENT_DATE - INTERVAL '3 months'",
    "last_6_months": "{col} >= CURRENT_DATE - INTERVAL '6 months'",
    "last_12_months": "{col} >= CURRENT_DATE - INTERVAL '12 months'",
    "this_year": "DATE_TRUNC('year', {col}) = DATE_TRUNC('year', CURRENT_DATE)",
    "last_year": "DATE_TRUNC('year', {col}) = DATE_TRUNC('year', CURRENT_DATE - INTERVAL '1 year')",
    # Indian financial year: April to March.
    "this_fy": "{col} >= DATE_TRUNC('year', CURRENT_DATE - INTERVAL '3 months') + INTERVAL '3 months'",
}

SORTS = {"metric_desc", "metric_asc", "dimension_asc", "dimension_desc"}
CHARTS = {"bar", "line", "pie", "table"}


class SpecError(ValueError):
    """The spec named something the registry does not contain."""


@dataclass
class CompiledQuery:
    sql: str
    params: list[Any]
    dataset: Dataset
    metric: Metric
    dimensions: list[Dimension]
    chart: str
    period: str
    columns: list[str] = field(default_factory=list)


def describe_for_model() -> str:
    """
    The registry, rendered for a prompt.

    Generated from the same structures the compiler validates against, so the
    two cannot drift — a model told about a metric that no longer exists would
    produce specs that are rejected, with nothing pointing at why.
    """
    lines: list[str] = []
    for ds in DATASETS.values():
        lines.append(f"dataset: {ds.key} — {ds.description}")
        lines.append("  metrics: " + ", ".join(
            f"{m.key} ({m.label})" for m in ds.metrics.values()
        ))
        lines.append("  dimensions: " + ", ".join(
            f"{d.key} ({d.label})" for d in ds.dimensions.values()
        ))
    lines.append("periods: " + ", ".join(PERIODS))
    lines.append("charts: " + ", ".join(sorted(CHARTS)))
    return "\n".join(lines)


def build(spec: dict, owner_email: str | None) -> CompiledQuery:
    """
    Compile a validated spec into parameterised SQL.

    `owner_email` comes from `owner_scope_email()` — None for a privileged role,
    an address for a scoped user. When it is set and the dataset has no ownership
    concept, the dataset is refused rather than queried: returning unscoped rows
    to a scoped user is precisely the leak this layer exists to prevent, and
    failing closed is the only safe default for data nobody has taught it to
    filter.
    """
    if not isinstance(spec, dict):
        raise SpecError("The generated query was not an object.")

    ds_key = str(spec.get("dataset") or "").strip()
    dataset = DATASETS.get(ds_key)
    if not dataset:
        raise SpecError(
            f"I can only query {', '.join(DATASETS)} — not '{ds_key or 'nothing'}'."
        )

    if owner_email and not dataset.owner_sql:
        raise SpecError(
            f"{dataset.label} cannot be filtered to your own records, so it is not "
            "available on a scoped account."
        )

    metric = dataset.metrics.get(str(spec.get("metric") or "").strip())
    if not metric:
        raise SpecError(
            f"'{spec.get('metric')}' is not a measure of {dataset.label}. "
            f"Available: {', '.join(dataset.metrics)}."
        )

    raw_dims = spec.get("dimensions") or []
    if not isinstance(raw_dims, list):
        raise SpecError("Dimensions must be a list.")
    dimensions: list[Dimension] = []
    for name in raw_dims[:2]:      # two is already a dense chart; more is a table nobody reads
        dim = dataset.dimensions.get(str(name).strip())
        if not dim:
            raise SpecError(
                f"'{name}' is not a way to group {dataset.label}. "
                f"Available: {', '.join(dataset.dimensions)}."
            )
        if dim not in dimensions:
            dimensions.append(dim)

    period = str(spec.get("period") or "all_time").strip()
    if period not in PERIODS:
        raise SpecError(f"'{period}' is not a period I know. Available: {', '.join(PERIODS)}.")

    sort = str(spec.get("sort") or "metric_desc").strip()
    if sort not in SORTS:
        sort = "metric_desc"

    chart = str(spec.get("chart") or "bar").strip()
    if chart not in CHARTS:
        chart = "bar"
    if not dimensions:
        chart = "table"   # a single number has nothing to plot

    try:
        limit = int(spec.get("limit") or DEFAULT_ROWS)
    except (TypeError, ValueError):
        limit = DEFAULT_ROWS
    limit = max(1, min(limit, MAX_ROWS))

    # --- assemble -----------------------------------------------------------
    params: list[Any] = []
    where = ["deleted_at IS NULL"]

    period_sql = PERIODS[period]
    if period_sql:
        where.append(period_sql.format(col=dataset.date_column))
        # A row with no date cannot belong to a period, and letting it through
        # would silently inflate every time-bounded total.
        where.append(f"{dataset.date_column} IS NOT NULL")

    # The scope predicate is appended here, by this function, from the caller's
    # session — never from the spec. There is no branch in which a spec can omit
    # it or a model can influence it.
    if owner_email and dataset.owner_sql:
        params.append(owner_email)
        where.append(dataset.owner_sql.format(p=f"${len(params)}"))

    select_parts = [f"{d.sql} AS {d.key}" for d in dimensions]
    select_parts.append(f"{metric.sql} AS value")
    columns = [d.key for d in dimensions] + ["value"]

    sql = f"SELECT {', '.join(select_parts)}\n  FROM {dataset.table}\n WHERE {' AND '.join(where)}"

    if dimensions:
        group = ", ".join(str(i + 1) for i in range(len(dimensions)))
        sql += f"\n GROUP BY {group}"
        if sort == "metric_desc":
            sql += f"\n ORDER BY value DESC NULLS LAST"
        elif sort == "metric_asc":
            sql += f"\n ORDER BY value ASC NULLS LAST"
        elif sort == "dimension_asc":
            sql += "\n ORDER BY 1 ASC"
        else:
            sql += "\n ORDER BY 1 DESC"

    params.append(limit)
    sql += f"\n LIMIT ${len(params)}"

    return CompiledQuery(
        sql=sql, params=params, dataset=dataset, metric=metric,
        dimensions=dimensions, chart=chart, period=period, columns=columns,
    )

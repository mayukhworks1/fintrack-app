"""
The query compiler — the security boundary of the analyst.

A model picks from a registry; this module turns that choice into SQL. Nothing
the model returns is ever interpolated into a statement, and the row scope is
appended by the compiler from the caller's session rather than by anything the
spec can influence. These tests exist because that property has to hold for
every path, not just the happy one.
"""

import pytest

from app.services import studio_analyst, studio_data
from app.services.studio_data import SpecError, build


def _spec(**over):
    base = {"dataset": "invoices", "metric": "total_outstanding",
            "dimensions": ["project"], "period": "all_time"}
    base.update(over)
    return base


class TestOnlyTheRegistryCanBeQueried:
    """Everything the model names is looked up, never interpolated."""

    def test_rejects_an_unknown_dataset(self):
        with pytest.raises(SpecError, match="I can only query"):
            build(_spec(dataset="auth_users"), None)

    def test_rejects_an_unknown_metric(self):
        with pytest.raises(SpecError, match="not a measure"):
            build(_spec(metric="password_hash"), None)

    def test_rejects_an_unknown_dimension(self):
        with pytest.raises(SpecError, match="not a way to group"):
            build(_spec(dimensions=["email"]), None)

    def test_rejects_an_unknown_period(self):
        with pytest.raises(SpecError, match="not a period"):
            build(_spec(period="since_forever"), None)

    def test_sql_injection_in_a_field_name_is_simply_not_found(self):
        """The name is a dictionary key, so a payload cannot reach the SQL —
        it fails the lookup like any other typo."""
        with pytest.raises(SpecError):
            build(_spec(metric="1; DROP TABLE invoices_mirror; --"), None)
        with pytest.raises(SpecError):
            build(_spec(dimensions=["project); DELETE FROM auth_users; --"]), None)

    def test_a_hostile_payload_never_appears_in_the_sql(self):
        payload = "'; DROP TABLE auth_users; --"
        try:
            compiled = build(_spec(dataset=payload), None)
        except SpecError:
            return                      # rejected, which is the point
        assert payload not in compiled.sql   # unreachable, but proves the property


class TestRowScoping:
    """
    Scoping in this codebase lives in Python, not the database. The compiler is
    therefore the only thing standing between a scoped user and everyone's rows.
    """

    def test_a_scoped_caller_gets_an_ownership_predicate(self):
        compiled = build(_spec(), "a@b.test")
        assert "Raised By" in compiled.sql
        assert "a@b.test" in compiled.params

    def test_the_predicate_is_a_bound_parameter_not_a_literal(self):
        compiled = build(_spec(), "a@b.test")
        assert "a@b.test" not in compiled.sql

    def test_a_privileged_caller_gets_no_predicate(self):
        compiled = build(_spec(), None)
        assert "Raised By" not in compiled.sql

    def test_the_spec_cannot_switch_scoping_off(self):
        """There is no key a model could emit that removes the predicate."""
        for hostile in ({"owner_email": None}, {"scope": "all"}, {"owner_sql": ""}):
            compiled = build(_spec(**hostile), "a@b.test")
            assert "Raised By" in compiled.sql

    def test_a_dataset_with_no_ownership_is_refused_to_a_scoped_caller(self):
        """Projects carry no owner column. Returning unscoped rows to a scoped
        user is the leak this layer exists to prevent, so it fails closed."""
        with pytest.raises(SpecError, match="scoped account"):
            build({"dataset": "projects", "metric": "total_billed",
                   "dimensions": ["client"]}, "a@b.test")

    def test_the_same_dataset_is_fine_for_a_privileged_caller(self):
        compiled = build({"dataset": "projects", "metric": "total_billed",
                          "dimensions": ["client"]}, None)
        assert "projects_mirror" in compiled.sql


class TestGeneratedSQL:
    def test_excludes_soft_deleted_rows(self):
        assert "deleted_at IS NULL" in build(_spec(), None).sql

    def test_a_period_also_excludes_undated_rows(self):
        """A row with no date belongs to no period; letting it through would
        silently inflate every time-bounded total."""
        compiled = build(_spec(period="last_12_months"), None)
        assert "raised_date IS NOT NULL" in compiled.sql

    def test_all_time_applies_no_date_filter(self):
        assert "INTERVAL" not in build(_spec(period="all_time"), None).sql

    def test_groups_by_the_requested_dimensions(self):
        compiled = build(_spec(dimensions=["project", "category"]), None)
        assert "GROUP BY 1, 2" in compiled.sql
        assert compiled.columns == ["project", "category", "value"]

    def test_no_dimensions_means_one_number_and_no_grouping(self):
        compiled = build(_spec(dimensions=[]), None)
        assert "GROUP BY" not in compiled.sql
        assert compiled.chart == "table"     # nothing to plot

    def test_caps_dimensions_at_two(self):
        compiled = build(_spec(dimensions=["project", "category", "payment_status"]), None)
        assert len(compiled.dimensions) == 2

    def test_ignores_a_duplicate_dimension(self):
        compiled = build(_spec(dimensions=["project", "project"]), None)
        assert len(compiled.dimensions) == 1

    def test_the_row_limit_is_bound_and_capped(self):
        compiled = build(_spec(limit=99999), None)
        assert studio_data.MAX_ROWS in compiled.params
        compiled = build(_spec(limit="not a number"), None)
        assert studio_data.DEFAULT_ROWS in compiled.params

    def test_a_negative_limit_cannot_produce_invalid_sql(self):
        compiled = build(_spec(limit=-5), None)
        assert compiled.params[-1] >= 1

    def test_falls_back_to_a_known_sort_rather_than_failing(self):
        compiled = build(_spec(sort="'; DROP TABLE x; --"), None)
        assert "DROP" not in compiled.sql
        assert "ORDER BY value DESC" in compiled.sql

    def test_falls_back_to_a_known_chart(self):
        assert build(_spec(chart="hologram"), None).chart == "bar"


class TestModelFacingDescription:
    """The prompt is generated from the same structures the compiler validates
    against, so the two cannot drift apart."""

    def test_every_dataset_and_metric_is_advertised(self):
        described = studio_data.describe_for_model()
        for key, ds in studio_data.DATASETS.items():
            assert key in described
            for metric in ds.metrics:
                assert metric in described

    def test_every_advertised_period_compiles(self):
        for period in studio_data.PERIODS:
            build(_spec(period=period), None)


class TestSpecShape:
    def test_a_non_object_spec_is_rejected(self):
        for bad in ([], "invoices", None, 7):
            with pytest.raises(SpecError):
                build(bad, None)

    def test_dimensions_must_be_a_list(self):
        with pytest.raises(SpecError, match="must be a list"):
            build(_spec(dimensions="project"), None)

    def test_an_empty_spec_names_what_was_missing(self):
        with pytest.raises(SpecError, match="I can only query"):
            build({}, None)


class TestSpecParsing:
    """Free models add prose and code fences despite being told not to."""

    def test_finds_json_inside_prose(self):
        from app.services.studio_analyst import parse_spec
        spec = parse_spec('Sure! Here you go:\n```json\n{"dataset": "invoices"}\n```')
        assert spec["dataset"] == "invoices"

    def test_finds_a_bare_object(self):
        from app.services.studio_analyst import parse_spec
        assert parse_spec('{"dataset": "projects"}')["dataset"] == "projects"

    def test_rejects_output_with_no_object_in_it(self):
        from app.services.studio_analyst import parse_spec
        for bad in ("I cannot help with that", "", "[1, 2, 3]"):
            with pytest.raises(SpecError):
                parse_spec(bad)

    def test_rejects_malformed_json(self):
        from app.services.studio_analyst import parse_spec
        with pytest.raises(SpecError):
            parse_spec('{"dataset": "invoices",}')


class TestValueFormatting:
    def test_matches_how_the_app_already_writes_numbers(self):
        from app.services.studio_analyst import format_value
        assert format_value(4821750, "currency") == "Rs 4,821,750"
        assert format_value(87.5, "percent") == "87.5%"
        assert format_value(34, "days") == "34 days"
        assert format_value(12, "number") == "12"

    def test_survives_a_non_numeric_value(self):
        from app.services.studio_analyst import format_value
        assert format_value(None, "currency") == "None"


class TestSpecExtraction:
    """
    "What are current outstanding?" came back as "I could not turn that into a
    query. Try rephrasing it." — for a question the model was answering
    correctly. The extractor was a single greedy `\\{.*\\}`, which spans from the
    first brace in the response to the last, so anything else braced in the
    reply swallowed the spec and broke the parse. Rephrasing could not have
    helped, which is what made the message actively misleading.
    """

    GOOD = ('{"dataset":"invoices","metric":"total_outstanding","dimensions":[],'
            '"period":"all_time","sort":"metric_desc","limit":10,"chart":"table"}')

    def _metric(self, raw):
        return studio_analyst.parse_spec(raw)["metric"]

    def test_a_bare_spec_still_parses(self):
        assert self._metric(self.GOOD) == "total_outstanding"

    def test_code_fences_are_stripped(self):
        assert self._metric(f"```json\n{self.GOOD}\n```") == "total_outstanding"

    def test_prose_on_either_side_is_ignored(self):
        assert self._metric(f"Sure! Here it is:\n{self.GOOD}") == "total_outstanding"
        assert self._metric(f"{self.GOOD}\n\nThat gives your total.") == "total_outstanding"

    def test_a_reasoning_trace_full_of_braces_is_discarded(self):
        raw = ("<think>Candidates are {total_raised, total_outstanding}; "
               "outstanding is the one asked for.</think>\n" + self.GOOD)
        assert self._metric(raw) == "total_outstanding"

    def test_a_brace_in_prose_no_longer_swallows_the_spec(self):
        raw = "The metric key is {total_outstanding}. Spec:\n" + self.GOOD
        assert self._metric(raw) == "total_outstanding"

    def test_a_trailing_note_no_longer_swallows_the_spec(self):
        assert self._metric(self.GOOD + "\nNote: use {month} to group.") == "total_outstanding"

    def test_an_example_object_is_skipped_for_the_real_spec(self):
        """The first balanced object is not automatically the answer."""
        raw = 'For example {"limit": 5} would cap it. Answer:\n' + self.GOOD
        assert self._metric(raw) == "total_outstanding"

    def test_a_brace_inside_a_string_value_does_not_break_counting(self):
        raw = '{"dataset":"invoices","metric":"total_outstanding","note":"use {x}"}'
        assert self._metric(raw) == "total_outstanding"

    def test_an_escaped_quote_inside_a_string_does_not_break_counting(self):
        raw = r'{"dataset":"invoices","metric":"total_outstanding","note":"a \"q\" {y}"}'
        assert self._metric(raw) == "total_outstanding"

    def test_a_refusal_object_is_returned_rather_than_treated_as_junk(self):
        spec = studio_analyst.parse_spec('{"error":"no such metric"}')
        assert spec["error"] == "no such metric"

    def test_a_response_with_no_json_at_all_still_fails(self):
        with pytest.raises(studio_data.SpecError):
            studio_analyst.parse_spec("I am unable to help with that request.")

    def test_the_failure_message_suggests_something_actionable(self):
        """"Try rephrasing it" alone gave the user nothing to act on."""
        with pytest.raises(studio_data.SpecError) as exc:
            studio_analyst.parse_spec("no json here")
        assert "outstanding by project" in str(exc.value)

    def test_the_extracted_spec_compiles_to_real_sql(self):
        """End to end: the reported question, through parse and compile."""
        compiled = studio_data.build(studio_analyst.parse_spec(self.GOOD), None)
        assert compiled.columns == ["value"]
        assert "invoices_mirror" in compiled.sql
        assert compiled.metric.unit == "currency"

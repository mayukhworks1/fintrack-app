"""The revenue sheet is filled from real invoices, projects and statuses."""
import csv
import io

from app.services.revenue_sheet import build_rows, to_csv


def test_rows_merge_invoices_projects_and_status():
    invoices = [
        {"Project": "PMS", "Client Name": "Birla Open Minds", "Amount Raised": 345600, "Amount Received": 0,
         "Outstanding Amount": 345600, "Payment Status": "Pending", "Raised Date": "2026-09-15T00:00:00Z"},
        {"Project": "PMS", "Client Name": "Birla Open Minds", "Amount Raised": 304200, "Amount Received": 304200,
         "Outstanding Amount": 0, "Payment Status": "Paid", "Raised Date": "2026-08-03T00:00:00Z"},
        {"Project": "PMS", "Amount Raised": 999, "Payment Status": "Cancelled"},
        {"Project": "Innovine", "Client": "Innovine", "Amount Raised": 40000, "Amount Received": 40000,
         "Payment Status": "Paid"},
    ]
    projects = [{"Project Name": "PMS", "Client": "Birla Open Minds", "Input cost so far": 100000,
                 "Total Overhead Cost": 20000, "Project Status": "In progress"}]
    statuses = [{"Client": "Birla Open Minds", "Project": "pms", "Short Status": "Final invoice overdue"},
                {"Client": "Jacarti", "Project": "ZOHO BIGIN", "Short Status": "Billing pending", "Status": "In progress"}]
    rows = {r["project"]: r for r in build_rows(invoices, projects, statuses)}
    pms = rows["PMS"]
    assert pms["invoices"] == 2 and pms["billed"] == 649800 and pms["received"] == 304200
    assert pms["outstanding"] == 345600 and pms["costs"] == 120000
    assert pms["update"] == "Final invoice overdue" and pms["last"].date().isoformat() == "2026-09-15"
    assert rows["ZOHO BIGIN"]["update"] == "Billing pending" and rows["ZOHO BIGIN"]["billed"] == 0
    assert rows["Innovine"]["billed"] == 40000


def test_csv_has_formulas_and_a_totals_row():
    rows = build_rows([{"Project": "A", "Amount Raised": 100, "Amount Received": 50,
                        "Outstanding Amount": 50, "Payment Status": "Pending"}], [], [])
    lines = list(csv.reader(io.StringIO(to_csv(rows))))
    assert lines[0][:4] == ["Client", "Project", "Invoices", "Billed (excl. GST)"]
    assert lines[1][7] == "=D2-G2" and lines[1][8] == "=IF(D2=0,0,H2/D2)"
    assert lines[2][0] == "Total" and lines[2][3] == "=SUM(D2:D2)"

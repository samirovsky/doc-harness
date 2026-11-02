@offline @ingestion
Feature: Ingestion of a mixed-format data room
  Raw CSV, PDF, DOCX, PPTX, XLSX and image files are discovered through the
  manifest and turned into normalized documents (text blocks and tables) that
  the answering core can reason over. Preprocessing is automatic and cached by
  file content, never by file name.

  Rule: Every supported format yields searchable content

    Background:
      Given the practice data room is ingested

    Scenario: Every manifest file becomes a non-empty document
      Then every manifest file yields a document with content

    Scenario Outline: Facts are extracted from each format
      Then the document "<fileId>" contains "<text>"

      Examples:
        | fileId                               | text                         |
        | 01_transfer_ledger_sep.csv           | TR-903                       |
        | 05_amendments_register.pdf           | Talon Rusk                   |
        | 09_quarterly_operations_brief.pptx   | DECLARED CRATES              |
        | 09_quarterly_operations_brief.pptx   | Any later Risk Committee     |
        | 14_asset_register.xlsx               | Economic life exhausted      |
        | 23_north_ring_operating_history.docx | Authority note               |
        | 11_warehouse_label.png               | COBALT                       |
        | 12_transfer_receipt.png              | 20,000 CREDITS               |

    Scenario: PDF table rows keep their cells on one line
      Then a line of "07_contracts_and_coverage.pdf" contains both "Coverage start" and "2025-01-01"

    Scenario: Spreadsheet sheets become tables with headers
      Then the document "14_asset_register.xlsx" has a table "Assets" with column "acquisition_cost" and 8 rows

    Scenario: Slide tables become tables with headers
      Then the document "10_risk_committee_update.pptx" has a table with column "Classification"

    Scenario: Word tables become tables with headers
      Then the document "24_blue_veldt_correspondence.docx" has a table with column "Archive value"

    Scenario: Images carry an OCR confidence
      Then the document "11_warehouse_label.png" has an OCR confidence of at least 60

  Rule: Discovery and caching are content-driven

    Scenario: Discovery follows the manifest, not hardcoded names
      Given a temporary data room copying "01_transfer_ledger_sep.csv" as "zz_renamed_export.csv"
      When the temporary data room is ingested
      Then the corpus has a document "zz_renamed_export.csv" containing "TR-903"

    Scenario: Parsed documents are cached by content hash
      Given a temporary data room with a CSV "tiny.csv" containing "k,v\na,1"
      When the temporary data room is ingested
      And the temporary data room is ingested
      Then the last ingestion served "tiny.csv" from cache
      When "tiny.csv" is rewritten with "k,v\nb,2" and the data room is ingested
      Then the last ingestion parsed "tiny.csv" afresh
      And the corpus has a document "tiny.csv" containing "b"

    Scenario: Spreadsheet formulas resolve to values and date cells render as ISO dates
      Given a temporary data room with a generated workbook "calc.xlsx" holding a date cell and a formula
      When the temporary data room is ingested
      Then the corpus has a document "calc.xlsx" containing "2025-03-04"
      And the corpus has a document "calc.xlsx" containing "300"

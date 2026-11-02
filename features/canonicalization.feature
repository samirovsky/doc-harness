@offline
Feature: Canonical answer values
  The scorer compares values with Object.is, so every raw model value is
  normalized per answer type: raw JSON numbers, ISO dates, lowercase text,
  JSON booleans, or null.

  Scenario Outline: Raw values are canonicalized per answer type
    When the raw value <raw> is canonicalized as a <type> answer
    Then the canonical value is <canonical>

    Examples:
      | raw                    | type    | canonical            |
      | "1,320,000 credits"    | number  | 1320000              |
      | "$76,000"              | number  | 76000                |
      | "-38,000"              | number  | -38000               |
      | "(12,500)"             | number  | -12500               |
      | 2000000                | number  | 2000000              |
      | "12.5%"                | number  | 12.5                 |
      | "2 million"            | number  | 2000000              |
      | "18 September 2025"    | date    | "2025-09-18"         |
      | "2025-09-18T00:00:00Z" | date    | "2025-09-18"         |
      | "Sep 1, 2025"          | date    | "2025-09-01"         |
      | "2025/9/1"             | date    | "2025-09-01"         |
      | "  Acme Signal Works. " | text   | "acme signal works"  |
      | "\"HIGH\""             | text    | "high"               |
      | "yes"                  | boolean | true                 |
      | "False"                | boolean | false                |
      | true                   | boolean | true                 |
      | null                   | number  | null                 |
      | "unknown"              | number  | null                 |

  Scenario Outline: Values that cannot be canonicalized are rejected
    When the raw value <raw> is canonicalized as a <type> answer
    Then the value is rejected as non-canonical

    Examples:
      | raw             | type    |
      | "about a lot"   | number  |
      | "next tuesday"  | date    |
      | "perhaps"       | boolean |
      | "2025-13-45"    | date    |

  Scenario: A code-evaluated calculation overrides the model's arithmetic
    Given a data room with documents:
      | fileId     | content                         |
      | ledger.csv | id,amount\nA,280000\nB,20000    |
    And a playbook with questions:
      | questionId | answerType | question                     |
      | q_sum      | number     | What is the total amount?    |
    And a model that answers "q_sum" with 290000 using calc "280000 + 20000" citing "ledger.csv"
    And escalation is disabled
    When the harness answers the playbook
    Then the answer to "q_sum" is 300000
    And the question "q_sum" was flagged for "calc_mismatch"

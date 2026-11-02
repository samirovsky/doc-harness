@offline
Feature: Reconciliation and agent escalation
  First-pass answers are checked deterministically. Answers that are invalid,
  low-confidence, inconsistent with their own calculation, or unsupported by
  evidence are escalated to a tool-using agent. The agent is bounded and its
  failure never makes things worse.

  Background:
    Given a data room with documents:
      | fileId      | content                                                         |
      | ledger.csv  | id,amount,status,scope\nT-1,100,completed,in\nT-2,250,reversed,in\nT-3,999,void,out |
      | summary.pdf | Quarter summary. Closing balance 4,321 credits.                 |
    And a playbook with questions:
      | questionId | answerType | question                                  |
      | q_bal      | number     | What is the closing balance?              |
      | q_rev      | number     | What amount was reversed in scope?        |

  Scenario: Missing evidence is grounded by locating the value in the corpus
    Given a model that answers "q_bal" with 4321 citing ""
    And escalation is disabled
    When the harness answers the playbook
    Then the answer to "q_bal" is 4321
    And the answer to "q_bal" cites exactly "summary.pdf"

  Scenario: Low-confidence answers are escalated to the agent
    Given a model that answers "q_rev" with 100 with confidence 0.2 citing "ledger.csv"
    And an agent that answers "q_rev" with 250 citing "ledger.csv"
    When the harness answers the playbook
    Then the answer to "q_rev" is 250
    And the question "q_rev" was escalated

  Scenario: Agent failure keeps the best first-pass answer
    Given a model that answers "q_rev" with 250 with confidence 0.2 citing "ledger.csv"
    And an agent that always fails
    When the harness answers the playbook
    Then the answer to "q_rev" is 250
    And the answer to "q_rev" cites exactly "ledger.csv"

  Scenario: The agent loop honors its step limit
    Given a model that answers "q_rev" with "lots" citing "ledger.csv"
    And an agent that keeps calling tools forever
    And an agent step limit of 3
    When the harness answers the playbook
    Then the agent made at most 3 model calls for "q_rev"
    And the answer to "q_rev" is null

  Scenario: The query_table tool aggregates filtered rows deterministically
    When the agent tool "query_table" runs with:
      """
      {"fileId":"ledger.csv","filters":[{"column":"scope","op":"eq","value":"in"},{"column":"status","op":"eq","value":"reversed"}],"aggregate":{"fn":"sum","column":"amount"}}
      """
    Then the tool result contains "250"

  Scenario: The calculate tool evaluates arithmetic and refuses code
    When the agent tool "calculate" runs with:
      """
      {"expression":"(120000 + 85000 + 45000 + 30000) + 20000"}
      """
    Then the tool result contains "300000"
    When the agent tool "calculate" runs with:
      """
      {"expression":"process.exit(1)"}
      """
    Then the tool result contains "error"

  Scenario: The search_corpus tool ranks the relevant document first
    When the agent tool "search_corpus" runs with:
      """
      {"query":"closing balance credits"}
      """
    Then the first search hit is "summary.pdf"

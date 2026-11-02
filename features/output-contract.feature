@offline
Feature: Output contract
  Whatever the model does, the harness returns a payload that satisfies the
  authoritative data/playbook/candidate-output-schema.json: one answer per
  question id, canonical values, and evidence only for non-null answers.

  Background:
    Given a data room with documents:
      | fileId           | content                                                  |
      | alpha_report.pdf | Registered name: Acme Signal Works. Closing balance 4,321 |
      | beta_ledger.csv  | id,amount,status\nT-1,100,completed\nT-2,250,reversed    |
    And a playbook with questions:
      | questionId | answerType | question                          |
      | q_a        | text       | What is the registered name?      |
      | q_b        | number     | What is the closing balance?      |
      | q_c        | boolean    | Was any transfer reversed?        |
      | q_d        | date       | When did the contract begin?      |

  Scenario: Every question is answered and keyed by its id
    Given a model that answers every question with a plausible value
    When the harness answers the playbook
    Then the output validates against the official output schema
    And every playbook question has exactly one answer
    And the output caseId equals the playbook caseId

  Scenario: Unsupported answers are null and cite no files
    Given a model that answers "q_d" with null citing "alpha_report.pdf"
    When the harness answers the playbook
    Then the answer to "q_d" is null
    And the answer to "q_d" cites no files

  Scenario: Unknown evidence ids are dropped and near-miss ids are normalized
    Given a model that answers "q_a" with "Acme Signal Works" citing "ghost.pdf, ALPHA_REPORT"
    When the harness answers the playbook
    Then the answer to "q_a" is "acme signal works"
    And the answer to "q_a" cites exactly "alpha_report.pdf"

  Scenario: A failing model degrades to null answers while the payload stays valid
    Given a model whose calls always fail
    When the harness answers the playbook
    Then the output validates against the official output schema
    And every answer is null and cites no files

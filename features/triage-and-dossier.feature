@offline
Feature: Authority triage and dossier building
  Before answering, documents are triaged once so that self-declared archives,
  other-entity records and training material stay out of the answer prompt.
  Triage fails open: when in doubt, a document stays in. When the remaining
  corpus is too large for the context budget, each batch gets a retrieved
  dossier instead of the full one.

  Background:
    Given a data room with documents:
      | fileId          | content                                                                 |
      | current.pdf     | Controlled register current through the close. Deductible 75,000      |
      | archive_old.pdf | Archive series. Not current case authority. Deductible 10,000          |
    And a playbook with questions:
      | questionId | answerType | question                          |
      | q_ded      | number     | What is the current deductible?   |

  Scenario: Archive documents are excluded from the dossier but indexed
    Given a model that triages "archive_old.pdf" as archive
    And a model that answers every question with a plausible value
    When the harness answers the playbook
    Then the answer prompt contains the full text of "current.pdf"
    And the answer prompt lists "archive_old.pdf" only in the excluded index

  Scenario: Triage failure fails open
    Given a model whose triage calls fail
    And a model that answers every question with a plausible value
    When the harness answers the playbook
    Then the answer prompt contains the full text of "current.pdf"
    And the answer prompt contains the full text of "archive_old.pdf"

  Scenario: Over-budget corpora switch to retrieved dossiers per batch
    Given a data room of 40 filler documents and one document "needle.csv" containing "zebra quota 512"
    And a playbook with questions:
      | questionId | answerType | question                          |
      | q_zebra    | number     | What is the zebra quota?          |
    And a dossier token budget of 1500
    And a model that answers every question with a plausible value
    When the harness answers the playbook
    Then every answer prompt dossier is within 1500 tokens
    And the answer prompt for "q_zebra" contains "zebra quota 512"

  Scenario: A triage that archives nothing for an over-budget corpus gets one retry
    Given a data room of 40 filler documents and one document "needle.csv" containing "zebra quota 512"
    And a playbook with questions:
      | questionId | answerType | question                          |
      | q_zebra    | number     | What is the zebra quota?          |
    And a dossier token budget of 1500
    And a model whose first triage archives nothing but later triages archive "filler_00.pdf"
    And a model that answers every question with a plausible value
    When the harness answers the playbook
    Then the model was asked to triage 2 times
    And the document "filler_00.pdf" was triaged as archive

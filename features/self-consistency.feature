@offline
Feature: Self-consistency check
  Every answer batch is also answered by an independent second pass (different
  sampling, reversed question order). Self-reported confidence never flagged
  an actual error, but disagreement between two passes does. Each
  disagreement is settled by one adjudication call that re-derives the answer
  from the dossier with both candidates' reasoning in view (one round trip,
  unlike the multi-step agent). The second pass never slows the run: whatever
  has not finished shortly after the first pass is abandoned, and its cost is
  still accounted for.

  Background:
    Given a data room with documents:
      | fileId     | content                                                                         |
      | ledger.csv | id,amount,status,scope\nT-1,100,completed,in\nT-2,250,reversed,in\nT-3,80,completed,in |
    And a playbook with questions:
      | questionId | answerType | question                                          |
      | q_count    | number     | How many in-scope transfers were completed?       |
      | q_total    | number     | What is the total of completed in-scope transfers? |

  Scenario: Agreeing passes are trusted without escalation
    Given a model that answers "q_count" with 2 citing "ledger.csv"
    When the harness answers the playbook
    Then the answer to "q_count" is 2
    And the question "q_count" was not escalated
    And 2 answer passes were run

  Scenario: Disagreeing passes are settled by an adjudication call
    Given a model that answers "q_count" with 3 in the first pass and 2 in the second pass citing "ledger.csv"
    And an adjudicator that answers "q_count" with 2 citing "ledger.csv"
    When the harness answers the playbook
    Then the question "q_count" was flagged for "disagreement"
    And the question "q_count" was adjudicated
    And the adjudicator saw both candidate answers for "q_count"
    And the question "q_count" was not escalated
    And the answer to "q_count" is 2

  Scenario: Without an adjudication verdict the first pass is kept
    Given a model that answers "q_count" with 3 in the first pass and 2 in the second pass citing "ledger.csv"
    And an adjudicator that always fails
    When the harness answers the playbook
    Then the answer to "q_count" is 3

  Scenario: A slow second pass never delays the run, but its cost is booked
    Given a model that answers every question with a plausible value
    And a model that reports a cost of 0.001 USD per call
    And a model whose second-pass calls take 3000 ms
    And a second-pass grace period of 100 ms
    When the harness answers the playbook
    Then the run took less than 1500 milliseconds
    And the estimated cost is greater than 0.0025 USD
    And no question was flagged for "disagreement"

  Scenario: The self-consistency check can be switched off
    Given a single answer pass
    When the harness answers the playbook
    Then 1 answer pass was run

  Scenario: A derived answer written in terms of other questions is computed from their final answers
    Given a playbook with questions:
      | questionId | answerType | question                                           |
      | q_gross    | number     | What was the gross value of the transfers?         |
      | q_rev      | number     | What amount was reversed?                          |
      | q_net      | number     | What was the net value after the reversal?         |
    And a model that answers "q_gross" with 430 citing "ledger.csv"
    And a model that answers "q_rev" with 250 citing "ledger.csv"
    And a model that answers "q_net" with 99 using calc "q_gross - q_rev" citing "ledger.csv"
    When the harness answers the playbook
    Then the answer to "q_net" is 180
    And the question "q_net" was flagged for "derived"

  Scenario: A disagreement is settled by derivation when only one pass derives the answer from other questions
    Given a playbook with questions:
      | questionId | answerType | question                                           |
      | q_gross    | number     | What was the gross value of the transfers?         |
      | q_rev      | number     | What amount was reversed?                          |
      | q_net      | number     | What was the net value after the reversal?         |
    And a model that answers "q_gross" with 430 citing "ledger.csv"
    And a model that answers "q_rev" with 250 citing "ledger.csv"
    And a model that answers "q_net" with 180 using calc "q_gross - q_rev" in the first pass and 99 in the second pass citing "ledger.csv"
    And an adjudicator that answers "q_net" with 99 citing "ledger.csv"
    When the harness answers the playbook
    Then the question "q_net" was flagged for "disagreement"
    And the question "q_net" was not adjudicated
    And the answer to "q_net" is 180

  Scenario: A derived answer follows its components even when a component was itself disputed
    Given a playbook with questions:
      | questionId | answerType | question                                           |
      | q_gross    | number     | What was the gross value of the transfers?         |
      | q_rev      | number     | What amount was reversed?                          |
      | q_net      | number     | What was the net value after the reversal?         |
    And a model that answers "q_gross" with 430 in the first pass and 330 in the second pass citing "ledger.csv"
    And a model that answers "q_rev" with 250 citing "ledger.csv"
    And a model that answers "q_net" with 180 using calc "q_gross - q_rev" in the first pass and 99 in the second pass citing "ledger.csv"
    And an adjudicator that answers "q_gross" with 330 citing "ledger.csv"
    And an adjudicator that answers "q_net" with 99 citing "ledger.csv"
    When the harness answers the playbook
    Then the question "q_gross" was adjudicated
    And the question "q_net" was not adjudicated
    And the answer to "q_gross" is 330
    And the answer to "q_net" is 80

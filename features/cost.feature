@offline
Feature: Cost accounting
  estimatedCostUsd covers every model call made during the run: triage,
  answer batches, vision fallback and agent steps.

  Background:
    Given a data room with documents:
      | fileId    | content           |
      | notes.pdf | Nothing relevant. |

  Scenario: Provider-reported cost is summed across all calls
    Given a playbook of 12 number questions
    And an answer batch size of 6
    And a model that reports a cost of 0.001 USD per call
    And a model that answers every question with a plausible value
    When the harness answers the playbook
    Then the model was called 3 times
    And the estimated cost is 0.003 USD

  Scenario: Missing provider cost is estimated from tokens at the price caps
    When a call reports 1000000 prompt tokens and 100000 completion tokens without a cost
    Then the estimated cost of that call is 0.26 USD

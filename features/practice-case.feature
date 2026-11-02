@live
Feature: Practice case end to end
  Against the real GLM 5.3 Flash model, the full pipeline answers the practice
  playbook with the precision, cost and speed targets agreed for this harness.
  Requires OPENROUTER_API_KEY and network access to openrouter.ai.

  Scenario: The harness meets the precision, cost and speed targets
    Given the practice data room is ingested
    And the live OpenRouter model
    When the harness answers the practice playbook
    Then the output validates against the official output schema
    And at least 46 of 50 answers match the practice key by value and source
    And the estimated cost is below 0.10 USD
    And the run took less than 45 seconds

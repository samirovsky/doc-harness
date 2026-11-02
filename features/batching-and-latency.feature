@offline
Feature: Topic-coherent batching and tail-latency control
  Related questions (e.g. gross, reversed and net amounts of the same
  transfers) are answered in the same call so the model keeps figures
  consistent. Slow calls are hedged with a duplicate request; the run takes
  the first result and still accounts for the abandoned call's cost.

  Scenario: Related questions land in the same answer batch
    Given a data room with documents:
      | fileId    | content           |
      | notes.pdf | Nothing relevant. |
    And a playbook with questions:
      | questionId | answerType | question                                                    |
      | q_1        | number     | What was the gross value of all September transfers?        |
      | q_2        | text       | Who is the current harbour master?                          |
      | q_3        | number     | How many crates were declared for the quarter?              |
      | q_4        | number     | What amount of September transfers was reversed?            |
      | q_5        | date       | When did the harbour master appointment become effective?   |
      | q_6        | number     | What is the difference between declared and delivered crates? |
      | q_7        | number     | What was the net value of September transfers after reversal? |
      | q_8        | number     | How many crates were delivered in the quarter?              |
    And an answer batch size of 3
    When the harness answers the playbook
    Then "q_1", "q_4" and "q_7" were answered in the same batch
    And "q_3", "q_6" and "q_8" were answered in the same batch
    And "q_2" and "q_5" were answered in the same batch

  Scenario: A slow answer call is hedged and both calls are paid for
    Given a data room with documents:
      | fileId    | content           |
      | notes.pdf | Nothing relevant. |
    And a playbook of 6 number questions
    And an answer batch size of 6
    And a single answer pass
    And a model whose first answer call takes 2000 ms and later calls take 10 ms
    And a model that reports a cost of 0.001 USD per call
    And answer calls are hedged after 100 ms
    When the harness answers the playbook
    Then the run took less than 1500 milliseconds
    And the model was called 3 times
    And the estimated cost is greater than 0.002 USD

  Scenario: Hedge copies trade hidden reasoning for speed
    Given a data room with documents:
      | fileId    | content           |
      | notes.pdf | Nothing relevant. |
    And a playbook of 6 number questions
    And an answer batch size of 6
    And a single answer pass
    And a model whose first answer call takes 2000 ms and later calls take 10 ms
    And answer calls are hedged after 100 ms with reasoning "off"
    When the harness answers the playbook
    Then the first answer call used reasoning "low"
    And the hedge answer call used reasoning "off"

  Scenario: A call that stays slow gets a second hedge
    Given a data room with documents:
      | fileId    | content           |
      | notes.pdf | Nothing relevant. |
    And a playbook of 6 number questions
    And an answer batch size of 6
    And a single answer pass
    And a model whose answer calls take 3000 ms, 3000 ms, then 10 ms
    And answer calls are hedged after 100 ms
    When the harness answers the playbook
    Then the run took less than 1500 milliseconds
    And the model was called 4 times

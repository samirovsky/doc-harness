@offline @tools
Feature: Helper commands for operators
  Four commands make the solution easy to set up, check, and run without the
  browser: harness:setup, harness:doctor, harness:answer and harness:api.
  They never print the OpenRouter key and they report problems with a fix.

  Rule: harness:setup prepares the environment file

    Scenario: A missing .env is created from .env.example
      Given an empty project folder with a .env.example
      When the setup command runs without a key in the environment
      Then a .env file exists with the content of .env.example
      And the setup report says the key still has to be set

    Scenario: An existing .env is never overwritten
      Given an empty project folder with a .env.example
      And the project .env is set to "OPENROUTER_API_KEY=already-set"
      When the setup command runs without a key in the environment
      Then the project .env still contains "OPENROUTER_API_KEY=already-set"
      And the setup report says the key is set

    Scenario: A key from the environment is stored without being printed
      Given an empty project folder with a .env.example
      When the setup command runs with the key "sk-test-secret-123" in the environment
      Then the project .env contains "OPENROUTER_API_KEY=sk-test-secret-123"
      And the setup report does not contain "sk-test-secret-123"

  Rule: harness:doctor checks everything a run needs

    Background:
      Given a project folder with a valid tiny data room and playbook

    Scenario: An offline check passes the data room, ingestion and playbook
      Given the project .env is set to "OPENROUTER_API_KEY=sk-test"
      When the doctor runs offline
      Then the doctor reports "data room" as "pass"
      And the doctor reports "ingestion" as "pass"
      And the doctor reports "playbook" as "pass"
      And the doctor reports "OpenRouter key" as "pass"
      And the doctor does not print "sk-test"

    Scenario: A missing key fails with a fix
      When the doctor runs offline
      Then the doctor reports "OpenRouter key" as "fail"
      And the doctor fix for "OpenRouter key" mentions "harness:setup"

    Scenario: A manifest that lists a missing file fails
      Given the manifest also lists "ghost.pdf"
      When the doctor runs offline
      Then the doctor reports "data room" as "fail"

    Scenario: Online checks validate the key and the configured model
      Given the project .env is set to "OPENROUTER_API_KEY=sk-test"
      And OpenRouter accepts the key and lists the configured model
      When the doctor runs online
      Then the doctor reports "OpenRouter account" as "pass"
      And the doctor reports "model" as "pass"

    Scenario: An invalid key is reported by the online check
      Given the project .env is set to "OPENROUTER_API_KEY=sk-bad"
      And OpenRouter rejects the key with status 401
      When the doctor runs online
      Then the doctor reports "OpenRouter account" as "fail"

  Rule: harness:answer runs the pipeline without the browser

    Scenario: The answer command writes the exact API payload
      Given a project folder with a valid tiny data room and playbook
      When the answer command runs with a scripted model
      Then the answer file validates against the official output schema
      And the answer file has one answer per playbook question

  Rule: harness:api calls a running server like the evaluator does

    Scenario: A successful response is saved, validated and scored
      Given a stub answer server that returns the practice answer key plus an estimated cost
      When the api command sends the practice playbook to the stub server
      Then the api result has status 200
      And the api result validates against the official output schema
      And the api score is 50 of 50

    Scenario: An error response is reported with its body
      Given a stub answer server that fails with "Answer engine failed"
      When the api command sends the practice playbook to the stub server
      Then the api result has status 501
      And the api error mentions "Answer engine failed"

    Scenario: An unreachable server is reported and nothing is saved
      Given no answer server is running
      When the api command sends the practice playbook to the stub server
      Then the api result has status 0
      And the api error mentions "is `npm run dev` running?"
      And no api output file was written

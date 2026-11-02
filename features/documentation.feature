@offline
Feature: The usage guides match the code
  GUIDE.md and GUIDE.fr.md are checked against the source on every test run,
  so a renamed command, flag, default or message cannot leave them wrong.

  Scenario Outline: Every documented command exists
    Then every "npm run" command in "<guide>" is a script in package.json

    Examples:
      | guide       |
      | GUIDE.md    |
      | GUIDE.fr.md |

  Scenario Outline: Every documented flag is accepted by its command
    Then every flag shown for a harness command in "<guide>" is declared by that command's script

    Examples:
      | guide       |
      | GUIDE.md    |
      | GUIDE.fr.md |

  Scenario Outline: Documented defaults equal the pipeline configuration
    Then every setting in the defaults table of "<guide>" equals its value in the pipeline configuration

    Examples:
      | guide       |
      | GUIDE.md    |
      | GUIDE.fr.md |

  Scenario Outline: Every message quoted in the guides is printed by the code
    Then both guides quote "<message>"
    And "<source>" prints "<message>"

    Examples:
      | message                                                                       | source                      |
      | OPENROUTER_API_KEY is not set: copy .env.example to .env and add your key     | lib/candidate/answer.ts     |
      | harness:answer failed:                                                        | scripts/answer.ts           |
      | is not set: run `npm run harness:setup` and put your OpenRouter key in .env   | scripts/lib/run.ts          |
      | OPENROUTER_API_KEY is not set (environment or .env)                           | scripts/evaluate.ts         |
      | key rejected (HTTP                                                            | scripts/lib/doctor.ts       |
      | cannot reach                                                                  | scripts/lib/doctor.ts       |
      | could not reach                                                               | scripts/lib/api.ts          |
      | is `npm run dev` running?                                                     | scripts/lib/api.ts          |
      | [doc-harness] ingested                                                        | build/doc-harness-plugin.ts |
      | doc-harness:trace:                                                            | lib/candidate/answer.ts     |

  Scenario: The English and French guides document the same commands and defaults
    Then "GUIDE.md" and "GUIDE.fr.md" mention the same "npm run" commands
    And "GUIDE.md" and "GUIDE.fr.md" document the same defaults

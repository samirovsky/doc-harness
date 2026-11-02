@offline
Feature: Architecture guarantees
  The answering core must stay portable (it runs inside workerd, which has no
  filesystem and forbids runtime code generation) and must not be tuned to the
  practice case, because the evaluation uses an unseen data room.

  Scenario: Inner layers never depend on outer layers
    Then no module in "lib/harness/domain" imports anything outside the domain layer
    And no module in "lib/harness/application" imports from "lib/harness/infrastructure"

  Scenario: The runtime core avoids Node-only APIs and code generation
    Then no module in "lib/harness/domain" or "lib/harness/application" uses "node:", "eval(" or "new Function"

  Scenario: The harness source contains no practice-case literals
    Then no harness source file mentions any practice file id
    And no harness source file mentions any of "kestrel, meridian, talon rusk, mira venn, cobalt, tr-905, ir-27, blue veldt, orbital clearing"

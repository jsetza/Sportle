# Rules baseline and limits

Consulted the official **2026 USA Pickleball rulebook** on November 17, 2026:
https://usapickleball.org/rules/
https://usapickleball.org/docs/rules/USAP-Official-Rulebook.pdf?court=2026

Implementation mapping:

| Rule area                        | Implementation                                                                                                                                                       | Verification                                        |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Court / net, section 3           | 6.096 × 13.4112 m court, 2.1336 m kitchen, 0.8636 m center / 0.9144 m side net                                                                                       | Constants and court renderer; swept net test        |
| Scoring, section 4               | Serving team alone earns points; 11, win by 2                                                                                                                        | Unit tests                                          |
| Positions / sequence, section 5  | Score parity determines service court, doubles second-server opening exception, correct receiver                                                                     | Unit tests                                          |
| Score call / serve, sections 6–7 | Visible score announcement; generated low legal underhand serve and foot placement                                                                                   | Assisted, not phone-measured; diagonal landing test |
| Lines, section 8                 | Landing point determines in/out; kitchen line excluded on serve                                                                                                      | Boundary tests                                      |
| Two bounces / faults, section 10 | Serve and return must bounce; double-bounce and wrong-side faults                                                                                                    | Unit tests                                          |
| Kitchen, section 9               | Foot radius; entry allowed to play bounced balls; volley in NVZ, volley before both feet re-established outside (0.2 s), and volley momentum into the NVZ are faults | Unit tests (gameplay.test.ts)                       |
| Net, section 13                  | Swept net-plane intersection; mesh contact deflects ball and does not immediately terminate rally                                                                    | Fast-crossing unit test                             |
| Net posts                        | Posts 12 in outside sidelines; post strike is a fault on the hitter; around-the-post below net height allowed                                                        | Unit tests                                          |

Known simplifications and remaining work:

- Serve motion is an assist, not fully player-controlled. No release/feet/waist position is inferred from phone sensors. The two-second generated serve replaces the real player’s service procedure.
- With keyboard movement, players control their own position, so kitchen entry, volley-in-NVZ and momentum faults arise from player choices. Without keys, kitchen entry is automatic (movement policy). "Both feet re-established" is modelled as 0.2 s outside the NVZ, not as individual feet.
- Momentum ends 0.6 s after the volley or when the player stops; it does not model partner contact, stumbling, or the full post-dead-ball follow-through lifecycle.
- **Slow bounce assist:** after a bounce the ball moves at 0.8× speed (it hangs about 1.25× as long at the same height). Rules are unaffected — the two-bounce rule, kitchen and in/out calls apply as normal — but real ball physics is not modelled after the bounce.
- **Ball striking a player (rule 11.A) is intentionally not enforced** (owner's choice for game feel): a ball that touches a character passes through. Carried/double contacts, net-touching player bodies, around-the-post recovery, replay/hinder disputes, and tournament procedures are not fully simulated.
- Line calls use a point of ground contact rather than a deforming ball footprint. Ball mesh is enlarged for readability; collision radius is independent.
- Shot errors come from a contact-quality model (timing, position, height, swing strength), not measured paddle physics. Bots receive equivalent execution noise.

Keep these limits visible in documentation. Do not claim complete tournament fidelity or that all official rules have exhaustive automated coverage.

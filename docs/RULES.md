# Rules baseline and limits

Consulted the official **2026 USA Pickleball rulebook** on November 17, 2026:
https://usapickleball.org/rules/
https://usapickleball.org/docs/rules/USAP-Official-Rulebook.pdf?court=2026

Implementation mapping:

| Rule area                        | Implementation                                                                                    | Verification                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Court / net, section 3           | 6.096 × 13.4112 m court, 2.1336 m kitchen, 0.8636 m center / 0.9144 m side net                    | Constants and court renderer; swept net test        |
| Scoring, section 4               | Serving team alone earns points; 11, win by 2                                                     | Unit tests                                          |
| Positions / sequence, section 5  | Score parity determines service court, doubles second-server opening exception, correct receiver  | Unit tests                                          |
| Score call / serve, sections 6–7 | Visible score announcement; generated low legal underhand serve and foot placement                | Assisted, not phone-measured; diagonal landing test |
| Lines, section 8                 | Landing point determines in/out; kitchen line excluded on serve                                   | Boundary tests                                      |
| Two bounces / faults, section 10 | Serve and return must bounce; double-bounce and wrong-side faults                                 | Unit tests                                          |
| Kitchen, section 11              | Foot radius plus boundary checks; volley momentum guard                                           | Unit test; auto movement prevents ordinary entry    |
| Net, section 13                  | Swept net-plane intersection; mesh contact deflects ball and does not immediately terminate rally | Fast-crossing unit test                             |

Known simplifications and remaining work:

- Serve motion is an assist, not fully player-controlled. No release/feet/waist position is inferred from phone sensors. The two-second generated serve replaces the real player’s service procedure.
- Characters cannot currently enter the kitchen, even for a legal bounced-ball dink. A later movement controller should support entry, both-feet exit, and full momentum tracking before calling this unrestricted kitchen play.
- Momentum checking is a guard on current auto movement; it does not model partner contact, a stumbling animation, or the full post-dead-ball follow-through lifecycle.
- Ball/body hits, net-post/support contact, carried/double contacts, net-touching player bodies, around-the-post recovery, replay/hinder disputes, and tournament procedures are not fully simulated.
- Line calls use a point of ground contact rather than a deforming ball footprint. Ball mesh is enlarged for readability; collision radius is independent.
- Bots currently emphasize drives/placement rather than a complete tactical repertoire.

Keep these limits visible in documentation. Do not claim complete tournament fidelity or that all official rules have exhaustive automated coverage.

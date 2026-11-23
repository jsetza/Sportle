# Security

Sportle has no accounts, passwords or stored personal data. Rooms, players and nicknames
live only in the server's memory and disappear when a room closes or the server restarts.

- Room, host and controller credentials are random tokens created at runtime; none are in this repository.
- No API keys or secrets are needed. Hosting settings (`PUBLIC_ORIGIN`, `PORT`) are plain
  environment variables; keep any real values in your host's dashboard or a local `.env`
  (ignored by git), never in a commit.
- The server validates every phone input (timestamps, sequence numbers, ranges), rate-limits
  joins and requests, and only serves files from its own client folder.

Found a problem? Please open a GitHub issue without exploit details, or contact the repository
owner through GitHub, and allow time for a fix before sharing details publicly.

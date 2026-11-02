# Patched TRE test sources

These sources are copied from OpenZeppelin/hardhat-tron revision `d3aa82e3914087778b0cdc21d6faa05be87cecd9`. Their original notices are retained. `provenance.json` records file digests. `TransactionCapsule.java` carries the java-tron GPL-3.0-or-later notice; `COPYING` contains GPLv3 and `LICENSE.upstream` retains the upstream repository notice.

The files are test/build fixtures and are excluded from the npm package. `npm run tre:build-jar` builds the overlay against pinned TRE and JDK images and writes a local jar under `.sunhat/tre/`. The jar is neither committed nor published. Set `SUNHAT_TRE_JAR_OUTPUT` to choose another output location, or `SUNHAT_PATCHED_TRE_JAR` when running the plugin integration suite against an already built jar.

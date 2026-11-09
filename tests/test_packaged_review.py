"""Exercise the real installer review and guardian boundary for this package."""
import os
from pathlib import Path
import shutil
import tempfile
import unittest

from aepm.bundle import pack, read_package
from aepm.io import load, write
from aepm.model import AepmError, canonical, digest
from aepm.test_identities import generate
from aepm.trust import sign, verify_package
from aepm.verification import review_package


class PackagedReviewTests(unittest.TestCase):
    def test_declared_locked_tool_and_guardian_acceptance(self):
        source = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory(prefix="rooms-guardian-") as temporary:
            root = Path(temporary).resolve()
            policy_path = generate(root / "identities")
            for broken in (True, False):
                with self.subTest(undeclared_tool=broken):
                    package = source
                    if broken:
                        package = root / "broken-source"
                        package.mkdir()
                        manifest = load(source / "component.json")
                        for entry in manifest["files"]:
                            target = package / entry["path"]
                            target.parent.mkdir(parents=True, exist_ok=True)
                            shutil.copyfile(source / entry["path"], target)
                        suite = next(s for s in manifest["verification"] if s["id"] == "types")
                        suite["prepare"][-1]["argv"] = ["npx", "wrangler", "types"]
                        write(package / "component.json", manifest)
                    store = root / ("broken-store" if broken else "corrected-store")
                    ref = pack(package, store)
                    manifest, _ = read_package(ref, store)
                    policy = load(policy_path)
                    policy["trustedExecution"] = [ref["digest"]]
                    write(policy_path, policy)
                    statements = store / "statements" / ref["digest"]
                    statements.mkdir(parents=True)
                    release = {"format": 1, "role": "release", "keyId": "local-release", **ref,
                               "sourceTreeDigest": manifest["identity"]["sourceTreeDigest"]}
                    write(statements / "release.json", release)
                    (statements / "release.sig").write_bytes(sign(release, "release", root / "identities/release.pem"))
                    report = review_package(ref, store, policy_path, True, allow_network=True)
                    self.assertEqual(len(report["suites"]), len(manifest["verification"]))
                    if broken:
                        types = next(s for s in report["suites"] if s["id"] == "types")
                        self.assertEqual(types["status"], "blocked", report)
                        self.assertEqual(types["reason"], "undeclared-tool", report)
                    else:
                        self.assertEqual(report["summary"]["required-local"], "passed", report)
                        evidence = os.environ.get("AEPM_REVIEW_EVIDENCE")
                        if evidence:
                            write(Path(evidence), report)
                    guardian = {"format": 1, "role": "guardian", "keyId": "local-guardian", **ref,
                                "dependencies": [], "previousReviewedDigest": None,
                                "scope": sorted({s["scope"] for s in report["suites"]}),
                                "verdict": "accepted", "reportDigest": digest(canonical(report))}
                    write(statements / "guardian.json", guardian)
                    (statements / "guardian.sig").write_bytes(sign(guardian, "guardian", root / "identities/guardian.pem"))
                    if broken:
                        with self.assertRaises(AepmError):
                            verify_package(ref, store, policy_path)
                    else:
                        verify_package(ref, store, policy_path)

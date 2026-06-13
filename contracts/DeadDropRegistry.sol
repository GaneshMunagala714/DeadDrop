// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * DeadDrop Registry
 * ETHGlobal NYC 2026
 *
 * Receives attested whistleblower verdicts from the Chainlink CRE DON.
 * The DON calls onReport() after reaching consensus. Identity is UNKNOWABLE.
 *
 * Severity:
 *   1 = minor policy violation   → InternalReport  (board only)
 *   2 = serious misconduct       → InternalReport  (board only)
 *   3 = critical public interest → PublicDisclosure (regulators / media)
 *
 * Deploy to Sepolia via Remix. No constructor args needed.
 */
contract DeadDropRegistry {

    // ── IReceiver (Chainlink Keystone) ────────────────────────────────────────

    /// @notice Called by the Chainlink CRE DON after consensus.
    /// @param report ABI-encoded (bool credible, uint8 severity, string route,
    ///               string reason, uint256 timestamp)
    function onReport(bytes calldata /* metadata */, bytes calldata report) external {
        (
            bool credible,
            uint8 severity,
            string memory route,
            string memory reason,
            uint256 timestamp
        ) = abi.decode(report, (bool, uint8, string, string, uint256));

        _store(credible, severity, route, reason, timestamp);
    }

    /// @dev ERC-165 — lets the Keystone forwarder verify this contract can receive reports.
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7  // ERC-165 itself
            || interfaceId == 0x49bc3a77; // IReceiver: onReport(bytes,bytes)
    }

    // ── Direct submission (backend fallback) ──────────────────────────────────

    /// @notice Called directly by the backend when CRE is not available.
    function submitAttestation(
        bool          credible,
        uint8         severity,
        string memory route,
        string memory reason,
        uint256       timestamp
    ) external {
        _store(credible, severity, route, reason, timestamp);
    }

    // ── Storage & Events ──────────────────────────────────────────────────────

    struct Attestation {
        bool    credible;
        uint8   severity;
        string  route;
        string  reason;
        uint256 timestamp;
    }

    Attestation[] public attestations;

    event InternalReport(
        uint256 indexed id,
        uint8           severity,
        string          reason,
        uint256         timestamp
    );

    event PublicDisclosure(
        uint256 indexed id,
        uint8           severity,
        string          reason,
        uint256         timestamp
    );

    function _store(
        bool          credible,
        uint8         severity,
        string memory route,
        string memory reason,
        uint256       timestamp
    ) internal {
        require(credible, "DeadDrop: claim not credible");
        require(severity >= 1 && severity <= 3, "DeadDrop: invalid severity");

        uint256 id = attestations.length;

        attestations.push(Attestation({
            credible:  true,
            severity:  severity,
            route:     route,
            reason:    reason,
            timestamp: timestamp
        }));

        if (severity <= 2) {
            emit InternalReport(id, severity, reason, timestamp);
        } else {
            emit PublicDisclosure(id, severity, reason, timestamp);
        }
    }

    // ── Read ──────────────────────────────────────────────────────────────────

    function getAttestation(uint256 id)
        external
        view
        returns (Attestation memory)
    {
        require(id < attestations.length, "DeadDrop: id out of range");
        return attestations[id];
    }

    function totalClaims() external view returns (uint256) {
        return attestations.length;
    }
}

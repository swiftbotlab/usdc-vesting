// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract UsdcVesting is ReentrancyGuard {
    /// @dev Invariants and design rules:
    /// - Native Arc USDC is escrowed as msg.value only; no ERC-20 transfers are used.
    /// - `_totalLocked` tracks outstanding obligations across all schedules: total - claimed - refunded.
    /// - Claiming is permissionless, but payouts always go to the stored beneficiary.
    /// - Cancellation is only for the original funder and only for revocable schedules.
    /// - Cancellation snapshots vesting at `cancelledAt`; later vesting cannot increase.
    /// - Checks-effects-interactions is enforced for all value-transferring state changes.
    /// - Schedule IDs start at 1 and increase monotonically.
    ///
    /// @dev Beneficiary transfer limitation (accepted design trade-off):
    /// - `claim()` delivers funds via a low-level call to the stored beneficiary address.
    ///   If the beneficiary is a contract that rejects native transfers (e.g. missing
    ///   receive()/fallback(), or an address blocklisted at the protocol layer on Arc),
    ///   `claim()` will revert with `TransferFailed` and the vested amount remains locked
    ///   in the contract until the transfer succeeds.
    /// - The beneficiary address is immutable once a schedule is created; there is no
    ///   beneficiary-update mechanism by design (prevents griefing via address substitution).
    /// - For a revocable schedule whose beneficiary is permanently undeliverable, the funder
    ///   MAY call `cancel()` to recover the unvested portion. The vested-but-undeliverable
    ///   amount is permanently locked in that scenario.
    /// - Funders should verify beneficiary addresses accept native USDC before creating
    ///   schedules, especially for contract-address beneficiaries.

    enum Kind {
        Linear,
        Tranches
    }

    struct Schedule {
        address funder;
        address beneficiary;
        uint128 total;
        uint128 claimed;
        uint128 refunded;
        uint64 start;
        uint64 cliff;
        uint64 end;
        uint64 cancelledAt;
        Kind kind;
        bool revocable;
    }

    struct Tranche {
        uint64 time;
        uint128 amount;
    }

    mapping(uint256 => Schedule) private _schedules;
    mapping(uint256 => Tranche[]) private _tranches;
    mapping(address => uint256[]) private _fundedIds;
    mapping(address => uint256[]) private _beneficiaryIds;

    uint256 private _scheduleCount;
    uint128 private _totalLocked;

    uint256 public constant MAX_TRANCHES = 100;
    uint256 public constant MAX_DURATION = 3650 days;

    error ZeroAmount();
    error AmountTooLarge();
    error ZeroAddress();
    error SelfSchedule();
    error InvalidSchedule();
    error UnknownSchedule();
    error NothingToClaim();
    error NothingToReclaim();
    error NotFunder();
    error NotRevocable();
    error AlreadyCancelled();
    error TransferFailed();

    event ScheduleCreated(
        uint256 indexed id,
        address indexed funder,
        address indexed beneficiary,
        Kind kind,
        uint128 total,
        uint64 start,
        uint64 cliff,
        uint64 end,
        bool revocable
    );
    event TrancheAdded(uint256 indexed id, uint256 index, uint64 time, uint128 amount);
    event Claimed(uint256 indexed id, address indexed beneficiary, uint256 amount, uint256 claimedTotal, address caller);
    event Cancelled(
        uint256 indexed id,
        address indexed funder,
        address indexed beneficiary,
        uint256 vestedAmount,
        uint256 refunded
    );

    /// @notice Creates a linear vesting schedule funded by native USDC sent as msg.value.
    function createLinear(
        address beneficiary,
        uint64 start,
        uint64 cliff,
        uint64 end,
        bool revocable
    ) external payable returns (uint256 id) {
        uint256 value = msg.value;
        if (value == 0) revert ZeroAmount();
        if (value > type(uint128).max) revert AmountTooLarge();
        if (beneficiary == address(0)) revert ZeroAddress();
        if (beneficiary == msg.sender) revert SelfSchedule();

        if (
            !(
                start < end && start <= cliff && cliff <= end && end > block.timestamp
                    && uint256(end - start) <= MAX_DURATION
            )
        ) revert InvalidSchedule();

        uint128 total = uint128(value);

        id = ++_scheduleCount;
        _schedules[id] = Schedule({
            funder: msg.sender,
            beneficiary: beneficiary,
            total: total,
            claimed: 0,
            refunded: 0,
            start: start,
            cliff: cliff,
            end: end,
            cancelledAt: 0,
            kind: Kind.Linear,
            revocable: revocable
        });

        _fundedIds[msg.sender].push(id);
        _beneficiaryIds[beneficiary].push(id);
        _totalLocked += total;

        emit ScheduleCreated(id, msg.sender, beneficiary, Kind.Linear, total, start, cliff, end, revocable);
    }

    /// @dev Validates tranche arrays and returns (first, last, total).
    ///      Extracted to reduce stack depth in createTranches.
    function _validateTranches(
        uint64[] calldata times,
        uint128[] calldata amounts,
        uint256 value
    ) internal view returns (uint64 first, uint64 last, uint128 total) {
        uint256 len = times.length;
        if (len == 0 || len > MAX_TRANCHES || len != amounts.length) revert InvalidSchedule();

        first = times[0];
        last = first;
        uint256 sum;

        for (uint256 i = 0; i < len; ++i) {
            uint64 t = times[i];
            uint128 a = amounts[i];
            if (i > 0 && t <= last) revert InvalidSchedule();
            if (a == 0) revert InvalidSchedule();
            sum += a;
            last = t;
        }

        if (sum != value) revert InvalidSchedule();
        if (last <= block.timestamp) revert InvalidSchedule();
        if (uint256(last - first) > MAX_DURATION) revert InvalidSchedule();

        total = uint128(value);
    }

    /// @notice Creates a tranche-based vesting schedule funded by native USDC sent as msg.value.
    function createTranches(
        address beneficiary,
        uint64[] calldata times,
        uint128[] calldata amounts,
        bool revocable
    ) external payable returns (uint256 id) {
        uint256 value = msg.value;
        if (value == 0) revert ZeroAmount();
        if (value > type(uint128).max) revert AmountTooLarge();
        if (beneficiary == address(0)) revert ZeroAddress();
        if (beneficiary == msg.sender) revert SelfSchedule();

        (uint64 first, uint64 last, uint128 total) = _validateTranches(times, amounts, value);

        id = ++_scheduleCount;
        _schedules[id] = Schedule({
            funder: msg.sender,
            beneficiary: beneficiary,
            total: total,
            claimed: 0,
            refunded: 0,
            start: first,
            cliff: first,
            end: last,
            cancelledAt: 0,
            kind: Kind.Tranches,
            revocable: revocable
        });

        uint256 len = times.length;
        for (uint256 i = 0; i < len; ++i) {
            _tranches[id].push(Tranche({time: times[i], amount: amounts[i]}));
        }

        _fundedIds[msg.sender].push(id);
        _beneficiaryIds[beneficiary].push(id);
        _totalLocked += total;

        emit ScheduleCreated(id, msg.sender, beneficiary, Kind.Tranches, total, first, first, last, revocable);

        for (uint256 i = 0; i < len; ++i) {
            emit TrancheAdded(id, i, times[i], amounts[i]);
        }
    }

    /// @notice Claims currently vested funds for a schedule; anyone may call, but funds go to the beneficiary.
    function claim(uint256 id) external nonReentrant returns (uint256 amount) {
        if (id == 0 || id > _scheduleCount) revert UnknownSchedule();

        Schedule storage schedule = _schedules[id];

        uint128 vested = vestedAt(id, uint64(block.timestamp));
        amount = vested - schedule.claimed;
        if (amount == 0) revert NothingToClaim();

        schedule.claimed += uint128(amount);
        _totalLocked -= uint128(amount);

        emit Claimed(id, schedule.beneficiary, amount, schedule.claimed, msg.sender);

        (bool ok,) = schedule.beneficiary.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    /// @notice Cancels a revocable schedule and refunds the unvested amount to the original funder.
    function cancel(uint256 id) external nonReentrant returns (uint256 refunded) {
        if (id == 0 || id > _scheduleCount) revert UnknownSchedule();

        Schedule storage schedule = _schedules[id];

        if (msg.sender != schedule.funder) revert NotFunder();
        if (!schedule.revocable) revert NotRevocable();
        if (schedule.cancelledAt != 0) revert AlreadyCancelled();

        uint128 vestedNow = vestedAt(id, uint64(block.timestamp));
        refunded = schedule.total - vestedNow;
        if (refunded == 0) revert NothingToReclaim();

        uint64 nowTs = uint64(block.timestamp);
        schedule.cancelledAt = nowTs;
        schedule.refunded = uint128(refunded);
        _totalLocked -= uint128(refunded);

        emit Cancelled(id, schedule.funder, schedule.beneficiary, vestedNow, refunded);

        (bool ok,) = schedule.funder.call{value: refunded}("");
        if (!ok) revert TransferFailed();
    }

    /// @notice Returns schedule data, or a zero-value struct for unknown IDs.
    function getSchedule(uint256 id) external view returns (Schedule memory) {
        if (id == 0 || id > _scheduleCount) {
            return Schedule({
                funder: address(0),
                beneficiary: address(0),
                total: 0,
                claimed: 0,
                refunded: 0,
                start: 0,
                cliff: 0,
                end: 0,
                cancelledAt: 0,
                kind: Kind.Linear,
                revocable: false
            });
        }
        return _schedules[id];
    }

    /// @notice Returns all tranches for a schedule, or an empty array for unknown/non-tranche schedules.
    function getTranches(uint256 id) external view returns (Tranche[] memory) {
        if (id == 0 || id > _scheduleCount) return new Tranche[](0);
        if (_schedules[id].kind != Kind.Tranches) return new Tranche[](0);
        return _tranches[id];
    }

    /// @notice Returns vested amount at a given timestamp; returns 0 for unknown IDs.
    function vestedAmount(uint256 id, uint64 at) external view returns (uint256) {
        if (id == 0 || id > _scheduleCount) return 0;
        return uint256(vestedAt(id, at));
    }

    /// @notice Returns currently claimable amount; returns 0 for unknown IDs.
    function claimable(uint256 id) external view returns (uint256) {
        if (id == 0 || id > _scheduleCount) return 0;
        Schedule storage schedule = _schedules[id];
        uint128 vested = vestedAt(id, uint64(block.timestamp));
        return uint256(vested - schedule.claimed);
    }

    /// @notice Returns schedule status: 0=None, 1=Active, 2=Completed, 3=Cancelled.
    function status(uint256 id) external view returns (uint8) {
        if (id == 0 || id > _scheduleCount) return 0;

        Schedule storage schedule = _schedules[id];

        if (uint256(schedule.claimed) + uint256(schedule.refunded) == uint256(schedule.total)) {
            return 2;
        }
        if (schedule.cancelledAt != 0) {
            return 3;
        }
        return 1;
    }

    /// @notice Returns all schedule IDs funded by the given address.
    function idsByFunder(address funder) external view returns (uint256[] memory) {
        return _fundedIds[funder];
    }

    /// @notice Returns the number of schedules created.
    function scheduleCount() external view returns (uint256) {
        return _scheduleCount;
    }

    /// @notice Returns total unclaimed and unrefunded amount locked across all schedules.
    function totalLocked() external view returns (uint256) {
        return _totalLocked;
    }

    /// @notice Returns all schedule IDs for which the given address is beneficiary.
    function idsByBeneficiary(address beneficiary) external view returns (uint256[] memory) {
        return _beneficiaryIds[beneficiary];
    }

    /// @notice Computes vested amount at timestamp `at` for a schedule ID.
    function vestedAt(uint256 id, uint64 at) internal view returns (uint128) {
        Schedule storage schedule = _schedules[id];

        uint64 effective = at;
        uint64 cancelledAt = schedule.cancelledAt;
        if (cancelledAt != 0 && effective > cancelledAt) {
            effective = cancelledAt;
        }

        if (schedule.kind == Kind.Linear) {
            if (effective < schedule.cliff) return 0;
            if (effective >= schedule.end) return schedule.total;

            return uint128(uint256(schedule.total) * (effective - schedule.start) / (schedule.end - schedule.start));
        }

        uint256 len = _tranches[id].length;
        uint128 sum;
        for (uint256 i = 0; i < len; ++i) {
            Tranche storage tranche = _tranches[id][i];
            if (tranche.time <= effective) {
                sum += tranche.amount;
            }
        }
        return sum;
    }
}

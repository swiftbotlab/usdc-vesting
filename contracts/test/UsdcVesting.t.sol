// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {UsdcVesting} from "../UsdcVesting.sol";

// ─────────────────────────────────────────────────────────────────────────────
// Helper contracts
// ─────────────────────────────────────────────────────────────────────────────

/// @dev Accepts native transfers — used as a well-behaved beneficiary / funder.
contract Receiver {
    receive() external payable {}
}

/// @dev Rejects every native transfer — used to trigger TransferFailed.
contract Rejector {
    receive() external payable {
        revert("rejected");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Unit + fuzz tests
// ─────────────────────────────────────────────────────────────────────────────

contract UsdcVestingTest is Test {
    UsdcVesting internal vesting;

    // Shared test addresses
    address internal funder    = makeAddr("funder");
    address internal alice     = makeAddr("alice");     // beneficiary
    address internal bob       = makeAddr("bob");       // third party
    address internal carol     = makeAddr("carol");     // another beneficiary

    // A large but valid amount (below uint128 max)
    uint256 internal constant AMOUNT = 1_000e18;

    // Typical schedule timestamps (set relative to block.timestamp in setUp)
    uint64 internal T0;   // now
    uint64 internal T1;   // +30 days  (start)
    uint64 internal T2;   // +90 days  (cliff)
    uint64 internal T3;   // +365 days (end)

    function setUp() public {
        vesting = new UsdcVesting();
        T0 = uint64(block.timestamp);
        T1 = T0 + 30 days;
        T2 = T0 + 90 days;
        T3 = T0 + 365 days;

        // Give funder and others plenty of native balance
        vm.deal(funder, 100_000e18);
        vm.deal(bob,    100_000e18);
        vm.deal(carol,  100_000e18);
    }

    // ─── internal helpers ────────────────────────────────────────────────────

    /// @dev Creates a revocable linear schedule from `funder` = `alice`.
    function _createLinear(uint256 value) internal returns (uint256 id) {
        vm.prank(funder);
        id = vesting.createLinear{value: value}(alice, T1, T2, T3, true);
    }

    /// @dev Creates a non-revocable linear schedule.
    function _createLinearNR(uint256 value) internal returns (uint256 id) {
        vm.prank(funder);
        id = vesting.createLinear{value: value}(alice, T1, T2, T3, false);
    }

    /// @dev Creates a two-tranche revocable schedule from `funder` = `alice`.
    function _createTranches2(uint256 v1, uint256 v2) internal returns (uint256 id) {
        uint64[]  memory times   = new uint64[](2);
        uint128[] memory amounts = new uint128[](2);
        times[0]   = T2;           amounts[0] = uint128(v1);
        times[1]   = T3;           amounts[1] = uint128(v2);
        vm.prank(funder);
        id = vesting.createTranches{value: v1 + v2}(alice, times, amounts, true);
    }

    // =========================================================================
    // 1. createLinear — happy path
    // =========================================================================

    function test_CreateLinear_HappyPath() public {
        uint256 valueBefore = address(vesting).balance;

        vm.expectEmit(true, true, true, true, address(vesting));
        emit UsdcVesting.ScheduleCreated(
            1, funder, alice, UsdcVesting.Kind.Linear,
            uint128(AMOUNT), T1, T2, T3, true
        );
        uint256 id = _createLinear(AMOUNT);

        assertEq(id, 1, "first id must be 1");

        UsdcVesting.Schedule memory s = vesting.getSchedule(id);
        assertEq(s.funder,      funder,             "funder mismatch");
        assertEq(s.beneficiary, alice,              "beneficiary mismatch");
        assertEq(s.total,       uint128(AMOUNT),    "total mismatch");
        assertEq(s.claimed,     0,                  "claimed should be 0");
        assertEq(s.refunded,    0,                  "refunded should be 0");
        assertEq(s.start,       T1,                 "start mismatch");
        assertEq(s.cliff,       T2,                 "cliff mismatch");
        assertEq(s.end,         T3,                 "end mismatch");
        assertEq(s.cancelledAt, 0,                  "cancelledAt should be 0");
        assertEq(uint8(s.kind), uint8(UsdcVesting.Kind.Linear), "kind mismatch");
        assertTrue(s.revocable,                     "should be revocable");

        // Contract received the funds
        assertEq(address(vesting).balance, valueBefore + AMOUNT, "contract balance wrong");

        // totalLocked updated
        assertEq(vesting.totalLocked(), AMOUNT, "totalLocked mismatch");

        // Index mappings populated
        uint256[] memory funded = vesting.idsByFunder(funder);
        assertEq(funded.length, 1, "funder ids length");
        assertEq(funded[0], 1,     "funder ids[0]");

        uint256[] memory beneIds = vesting.idsByBeneficiary(alice);
        assertEq(beneIds.length, 1, "beneficiary ids length");
        assertEq(beneIds[0], 1,     "beneficiary ids[0]");

        assertEq(vesting.scheduleCount(), 1, "scheduleCount");
    }

    function test_CreateLinear_ScheduleCount_Increments() public {
        _createLinear(AMOUNT);
        _createLinear(AMOUNT);
        assertEq(vesting.scheduleCount(), 2, "scheduleCount after 2 creates");
    }

    // =========================================================================
    // 2. createLinear — all revert paths
    // =========================================================================

    function test_CreateLinear_RevertZeroAmount() public {
        vm.prank(funder);
        vm.expectRevert(UsdcVesting.ZeroAmount.selector);
        vesting.createLinear{value: 0}(alice, T1, T2, T3, true);
    }

    function test_CreateLinear_RevertAmountTooLarge() public {
        uint256 tooLarge = uint256(type(uint128).max) + 1;
        vm.deal(funder, tooLarge + 1);
        vm.prank(funder);
        vm.expectRevert(UsdcVesting.AmountTooLarge.selector);
        vesting.createLinear{value: tooLarge}(alice, T1, T2, T3, true);
    }

    function test_CreateLinear_RevertZeroAddress() public {
        vm.prank(funder);
        vm.expectRevert(UsdcVesting.ZeroAddress.selector);
        vesting.createLinear{value: AMOUNT}(address(0), T1, T2, T3, true);
    }

    function test_CreateLinear_RevertSelfSchedule() public {
        vm.prank(funder);
        vm.expectRevert(UsdcVesting.SelfSchedule.selector);
        vesting.createLinear{value: AMOUNT}(funder, T1, T2, T3, true);
    }

    /// start >= end
    function test_CreateLinear_RevertInvalidSchedule_StartGeEnd() public {
        vm.prank(funder);
        vm.expectRevert(UsdcVesting.InvalidSchedule.selector);
        // start == end
        vesting.createLinear{value: AMOUNT}(alice, T3, T3, T3, true);
    }

    /// cliff < start
    function test_CreateLinear_RevertInvalidSchedule_CliffBeforeStart() public {
        vm.prank(funder);
        vm.expectRevert(UsdcVesting.InvalidSchedule.selector);
        // cliff < start
        vesting.createLinear{value: AMOUNT}(alice, T2, T1, T3, true);
    }

    /// cliff > end
    function test_CreateLinear_RevertInvalidSchedule_CliffAfterEnd() public {
        vm.prank(funder);
        vm.expectRevert(UsdcVesting.InvalidSchedule.selector);
        // cliff > end: use T1 start, T3+1 cliff, T3 end
        vesting.createLinear{value: AMOUNT}(alice, T1, T3 + 1, T3, true);
    }

    /// end <= block.timestamp  (end is in the past)
    function test_CreateLinear_RevertInvalidSchedule_EndInPast() public {
        vm.warp(T3 + 1);
        vm.prank(funder);
        vm.expectRevert(UsdcVesting.InvalidSchedule.selector);
        vesting.createLinear{value: AMOUNT}(alice, T1, T2, T3, true);
    }

    /// duration > MAX_DURATION (3650 days)
    function test_CreateLinear_RevertInvalidSchedule_DurationTooLong() public {
        uint64 longEnd = T1 + uint64(vesting.MAX_DURATION()) + 1;
        vm.prank(funder);
        vm.expectRevert(UsdcVesting.InvalidSchedule.selector);
        vesting.createLinear{value: AMOUNT}(alice, T1, T1, longEnd, true);
    }

    // =========================================================================
    // 3. createTranches — happy path
    // =========================================================================

    function test_CreateTranches_HappyPath() public {
        uint64[]  memory times   = new uint64[](3);
        uint128[] memory amounts = new uint128[](3);
        times[0]   = T2;       amounts[0] = 300e18;
        times[1]   = T3;       amounts[1] = 400e18;
        times[2]   = T3 + 30 days; amounts[2] = 300e18;
        uint256 total = 1_000e18;

        vm.expectEmit(true, true, true, true, address(vesting));
        emit UsdcVesting.ScheduleCreated(
            1, funder, alice, UsdcVesting.Kind.Tranches,
            uint128(total), times[0], times[0], times[2], true
        );
        // Expect TrancheAdded events for each tranche
        vm.expectEmit(true, false, false, true, address(vesting));
        emit UsdcVesting.TrancheAdded(1, 0, times[0], amounts[0]);
        vm.expectEmit(true, false, false, true, address(vesting));
        emit UsdcVesting.TrancheAdded(1, 1, times[1], amounts[1]);
        vm.expectEmit(true, false, false, true, address(vesting));
        emit UsdcVesting.TrancheAdded(1, 2, times[2], amounts[2]);

        vm.prank(funder);
        uint256 id = vesting.createTranches{value: total}(alice, times, amounts, true);

        assertEq(id, 1, "id");

        UsdcVesting.Schedule memory s = vesting.getSchedule(id);
        assertEq(uint8(s.kind), uint8(UsdcVesting.Kind.Tranches), "kind");
        assertEq(s.start, times[0], "start = first time");
        assertEq(s.cliff, times[0], "cliff = first time");
        assertEq(s.end,   times[2], "end = last time");
        assertEq(s.total, uint128(total), "total");

        UsdcVesting.Tranche[] memory tr = vesting.getTranches(id);
        assertEq(tr.length, 3, "tranche count");
        assertEq(tr[0].time,   times[0],   "tr[0].time");
        assertEq(tr[0].amount, amounts[0], "tr[0].amount");
        assertEq(tr[1].time,   times[1],   "tr[1].time");
        assertEq(tr[1].amount, amounts[1], "tr[1].amount");
        assertEq(tr[2].time,   times[2],   "tr[2].time");
        assertEq(tr[2].amount, amounts[2], "tr[2].amount");

        assertEq(vesting.totalLocked(), total, "totalLocked");
    }

    // =========================================================================
    // 4. createTranches — all revert paths
    // =========================================================================

    function test_CreateTranches_RevertZeroAmount() public {
        uint64[]  memory times   = new uint64[](1);
        uint128[] memory amounts = new uint128[](1);
        times[0]   = T3;
        amounts[0] = 100e18;
        vm.prank(funder);
        vm.expectRevert(UsdcVesting.ZeroAmount.selector);
        vesting.createTranches{value: 0}(alice, times, amounts, true);
    }

    function test_CreateTranches_RevertAmountTooLarge() public {
        uint256 tooLarge = uint256(type(uint128).max) + 1;
        vm.deal(funder, tooLarge + 1);
        uint64[]  memory times   = new uint64[](1);
        uint128[] memory amounts = new uint128[](1);
        // amounts[0] would overflow uint128 anyway — just need the outer guard to fire
        // We pass value=tooLarge so the outer check fires before _validateTranches
        times[0]   = T3;
        amounts[0] = 1;
        vm.prank(funder);
        vm.expectRevert(UsdcVesting.AmountTooLarge.selector);
        vesting.createTranches{value: tooLarge}(alice, times, amounts, true);
    }

    function test_CreateTranches_RevertZeroAddress() public {
        uint64[]  memory times   = new uint64[](1);
        uint128[] memory amounts = new uint128[](1);
        times[0]   = T3; amounts[0] = 100e18;
        vm.prank(funder);
        vm.expectRevert(UsdcVesting.ZeroAddress.selector);
        vesting.createTranches{value: 100e18}(address(0), times, amounts, true);
    }

    function test_CreateTranches_RevertSelfSchedule() public {
        uint64[]  memory times   = new uint64[](1);
        uint128[] memory amounts = new uint128[](1);
        times[0]   = T3; amounts[0] = 100e18;
        vm.prank(funder);
        vm.expectRevert(UsdcVesting.SelfSchedule.selector);
        vesting.createTranches{value: 100e18}(funder, times, amounts, true);
    }

    function test_CreateTranches_RevertInvalidSchedule_EmptyTranches() public {
        uint64[]  memory times   = new uint64[](0);
        uint128[] memory amounts = new uint128[](0);
        vm.prank(funder);
        vm.expectRevert(UsdcVesting.InvalidSchedule.selector);
        vesting.createTranches{value: 100e18}(alice, times, amounts, true);
    }

    function test_CreateTranches_RevertInvalidSchedule_TooManyTranches() public {
        uint256 n = vesting.MAX_TRANCHES() + 1;
        uint64[]  memory times   = new uint64[](n);
        uint128[] memory amounts = new uint128[](n);
        for (uint256 i = 0; i < n; i++) {
            times[i]   = T2 + uint64(i + 1) * 1 days;
            amounts[i] = 1e18;
        }
        vm.deal(funder, n * 1e18 + 1 ether);
        vm.prank(funder);
        vm.expectRevert(UsdcVesting.InvalidSchedule.selector);
        vesting.createTranches{value: n * 1e18}(alice, times, amounts, true);
    }

    function test_CreateTranches_RevertInvalidSchedule_UnequalLengths() public {
        uint64[]  memory times   = new uint64[](2);
        uint128[] memory amounts = new uint128[](1);
        times[0]   = T2; times[1] = T3;
        amounts[0] = 100e18;
        vm.prank(funder);
        vm.expectRevert(UsdcVesting.InvalidSchedule.selector);
        vesting.createTranches{value: 100e18}(alice, times, amounts, true);
    }

    function test_CreateTranches_RevertInvalidSchedule_NonStrictlyIncreasingTimes() public {
        uint64[]  memory times   = new uint64[](2);
        uint128[] memory amounts = new uint128[](2);
        times[0]   = T3;     amounts[0] = 500e18;
        times[1]   = T3;     amounts[1] = 500e18; // same time — not strictly increasing
        vm.prank(funder);
        vm.expectRevert(UsdcVesting.InvalidSchedule.selector);
        vesting.createTranches{value: 1_000e18}(alice, times, amounts, true);
    }

    function test_CreateTranches_RevertInvalidSchedule_ZeroTrancheAmount() public {
        uint64[]  memory times   = new uint64[](2);
        uint128[] memory amounts = new uint128[](2);
        times[0]   = T2;     amounts[0] = 0;       // zero amount tranche
        times[1]   = T3;     amounts[1] = 1_000e18;
        vm.prank(funder);
        vm.expectRevert(UsdcVesting.InvalidSchedule.selector);
        vesting.createTranches{value: 1_000e18}(alice, times, amounts, true);
    }

    function test_CreateTranches_RevertInvalidSchedule_SumNotEqualValue() public {
        uint64[]  memory times   = new uint64[](2);
        uint128[] memory amounts = new uint128[](2);
        times[0]   = T2;     amounts[0] = 300e18;
        times[1]   = T3;     amounts[1] = 400e18; // sum = 700, value = 1000
        vm.prank(funder);
        vm.expectRevert(UsdcVesting.InvalidSchedule.selector);
        vesting.createTranches{value: 1_000e18}(alice, times, amounts, true);
    }

    function test_CreateTranches_RevertInvalidSchedule_LastInPast() public {
        vm.warp(T3 + 1); // now past T3
        uint64[]  memory times   = new uint64[](2);
        uint128[] memory amounts = new uint128[](2);
        times[0]   = T2;     amounts[0] = 500e18;
        times[1]   = T3;     amounts[1] = 500e18;
        vm.prank(funder);
        vm.expectRevert(UsdcVesting.InvalidSchedule.selector);
        vesting.createTranches{value: 1_000e18}(alice, times, amounts, true);
    }

    function test_CreateTranches_RevertInvalidSchedule_DurationTooLong() public {
        uint64 first = uint64(block.timestamp + 1 days);
        uint64 last  = first + uint64(vesting.MAX_DURATION()) + 1;
        uint64[]  memory times   = new uint64[](2);
        uint128[] memory amounts = new uint128[](2);
        times[0]   = first;  amounts[0] = 500e18;
        times[1]   = last;   amounts[1] = 500e18;
        vm.prank(funder);
        vm.expectRevert(UsdcVesting.InvalidSchedule.selector);
        vesting.createTranches{value: 1_000e18}(alice, times, amounts, true);
    }

    // =========================================================================
    // 5. Linear vesting math
    // =========================================================================

    function test_LinearVesting_BeforeCliff_ZeroCliff() public {
        // cliff == start = vesting starts immediately when cliff is at start
        vm.prank(funder);
        uint256 id = vesting.createLinear{value: AMOUNT}(alice, T1, T1, T3, true);

        // At T1 (start == cliff), exactly at the cliff: should begin vesting
        uint256 elapsed = T1 - T1;   // 0
        uint256 duration = T3 - T1;
        uint256 expected = AMOUNT * elapsed / duration; // 0

        assertEq(vesting.vestedAmount(id, T1), expected, "vested at start");
        assertEq(vesting.vestedAmount(id, T0), 0, "vested before start");
    }

    function test_LinearVesting_BeforeCliff_NonZeroCliff() public {
        // T2 > T1, nothing vested until cliff
        uint256 id = _createLinear(AMOUNT);
        // halfway between start and cliff — still 0
        uint64 midCliff = T1 + (T2 - T1) / 2;
        assertEq(vesting.vestedAmount(id, midCliff), 0, "should be 0 before cliff");
        assertEq(vesting.vestedAmount(id, T2 - 1),   0, "should be 0 one second before cliff");
    }

    function test_LinearVesting_AtCliff() public {
        uint256 id = _createLinear(AMOUNT);
        // At cliff, vesting is proportional: AMOUNT * (cliff - start) / (end - start)
        uint256 expected = AMOUNT * (T2 - T1) / (T3 - T1);
        assertEq(vesting.vestedAmount(id, T2), expected, "vested at cliff");
    }

    function test_LinearVesting_BetweenCliffAndEnd() public {
        uint256 id = _createLinear(AMOUNT);
        uint64 mid = T2 + (T3 - T2) / 2;
        uint256 expected = AMOUNT * (mid - T1) / (T3 - T1);
        assertEq(vesting.vestedAmount(id, mid), expected, "vested at midpoint");
    }

    function test_LinearVesting_AtEnd() public {
        uint256 id = _createLinear(AMOUNT);
        assertEq(vesting.vestedAmount(id, T3), AMOUNT, "fully vested at end");
    }

    function test_LinearVesting_AfterEnd() public {
        uint256 id = _createLinear(AMOUNT);
        assertEq(vesting.vestedAmount(id, T3 + 365 days), AMOUNT, "fully vested after end");
    }

    // =========================================================================
    // 6. Tranches vesting math
    // =========================================================================

    function test_TrancheVesting_BeforeFirstTranche() public {
        uint256 id = _createTranches2(600e18, 400e18);
        // T1 is before T2 (first tranche)
        assertEq(vesting.vestedAmount(id, T1), 0, "nothing vested before first tranche");
    }

    function test_TrancheVesting_ExactlyAtFirstTranche() public {
        uint256 id = _createTranches2(600e18, 400e18);
        assertEq(vesting.vestedAmount(id, T2), 600e18, "first tranche vested at T2");
    }

    function test_TrancheVesting_BetweenTranches() public {
        uint256 id = _createTranches2(600e18, 400e18);
        uint64 mid = T2 + (T3 - T2) / 2;
        // Only first tranche vested between T2 and T3
        assertEq(vesting.vestedAmount(id, mid), 600e18, "only first tranche between T2..T3");
    }

    function test_TrancheVesting_ExactlyAtLastTranche() public {
        uint256 id = _createTranches2(600e18, 400e18);
        assertEq(vesting.vestedAmount(id, T3), 1_000e18, "fully vested at T3");
    }

    function test_TrancheVesting_AfterLastTranche() public {
        uint256 id = _createTranches2(600e18, 400e18);
        assertEq(vesting.vestedAmount(id, T3 + 365 days), 1_000e18, "fully vested after last tranche");
    }

    // =========================================================================
    // 7. claim — happy path
    // =========================================================================

    function test_Claim_LinearHappyPath() public {
        uint256 id = _createLinear(AMOUNT);

        // Warp to halfway between cliff and end
        uint64 mid = T2 + (T3 - T2) / 2;
        vm.warp(mid);

        uint256 expectedVested    = AMOUNT * (mid - T1) / (T3 - T1);
        uint256 aliceBalanceBefore = alice.balance;
        uint256 lockedBefore       = vesting.totalLocked();

        vm.expectEmit(true, true, false, false, address(vesting));
        emit UsdcVesting.Claimed(id, alice, expectedVested, expectedVested, bob);

        vm.prank(bob);
        uint256 claimed = vesting.claim(id);

        assertEq(claimed, expectedVested, "claimed return value");
        assertEq(alice.balance, aliceBalanceBefore + expectedVested, "alice balance");
        assertEq(vesting.totalLocked(), lockedBefore - expectedVested, "totalLocked");

        UsdcVesting.Schedule memory s = vesting.getSchedule(id);
        assertEq(s.claimed, uint128(expectedVested), "schedule.claimed");
    }

    function test_Claim_AtEnd_FullAmount() public {
        uint256 id = _createLinear(AMOUNT);
        vm.warp(T3);

        uint256 aliceBefore = alice.balance;
        vm.prank(bob);
        uint256 claimed = vesting.claim(id);

        assertEq(claimed, AMOUNT, "claimed full amount");
        assertEq(alice.balance, aliceBefore + AMOUNT, "alice got full amount");
        assertEq(vesting.totalLocked(), 0, "totalLocked zero after full claim");
    }

    function test_Claim_TranchesHappyPath() public {
        uint256 id = _createTranches2(600e18, 400e18);
        vm.warp(T2); // exactly at first tranche

        uint256 aliceBefore = alice.balance;
        uint256 claimed = vesting.claim(id);

        assertEq(claimed, 600e18, "first tranche claimed");
        assertEq(alice.balance, aliceBefore + 600e18, "alice balance after first tranche");
        assertEq(vesting.totalLocked(), 1_000e18 - 600e18, "totalLocked after first claim");

        // Claim second tranche
        vm.warp(T3);
        uint256 claimed2 = vesting.claim(id);
        assertEq(claimed2, 400e18, "second tranche claimed");
        assertEq(vesting.totalLocked(), 0, "totalLocked zero after second claim");
    }

    // =========================================================================
    // 8. claim — revert paths
    // =========================================================================

    function test_Claim_RevertUnknownSchedule_IdZero() public {
        vm.expectRevert(UsdcVesting.UnknownSchedule.selector);
        vesting.claim(0);
    }

    function test_Claim_RevertUnknownSchedule_IdBeyondCount() public {
        _createLinear(AMOUNT);
        vm.expectRevert(UsdcVesting.UnknownSchedule.selector);
        vesting.claim(999);
    }

    function test_Claim_RevertNothingToClaim_NothingVestedYet() public {
        uint256 id = _createLinear(AMOUNT);
        // Still before cliff
        vm.expectRevert(UsdcVesting.NothingToClaim.selector);
        vesting.claim(id);
    }

    function test_Claim_RevertNothingToClaim_AllAlreadyClaimed() public {
        uint256 id = _createLinear(AMOUNT);
        vm.warp(T3); // fully vested
        vesting.claim(id);
        // Second claim should have nothing left
        vm.expectRevert(UsdcVesting.NothingToClaim.selector);
        vesting.claim(id);
    }

    // =========================================================================
    // 9. claim is permissionless — third party call, funds go to beneficiary
    // =========================================================================

    function test_Claim_Permissionless_ThirdPartyCallFundsBeneficiary() public {
        uint256 id = _createLinear(AMOUNT);
        vm.warp(T3);

        uint256 aliceBefore = alice.balance;
        uint256 bobBefore   = bob.balance;

        vm.prank(bob);
        uint256 claimed = vesting.claim(id);

        assertEq(claimed, AMOUNT, "claimed amount");
        // Alice got the funds, not bob
        assertEq(alice.balance, aliceBefore + AMOUNT, "alice balance increased");
        assertEq(bob.balance,   bobBefore,             "bob balance unchanged");
    }

    // =========================================================================
    // 10. cancel — happy path with event
    // =========================================================================

    function test_Cancel_HappyPath_AtCliff() public {
        uint256 id = _createLinear(AMOUNT);
        vm.warp(T2); // at cliff

        uint256 vestedNow   = vesting.vestedAmount(id, uint64(block.timestamp));
        uint256 expectedRef = AMOUNT - vestedNow;

        uint256 funderBefore = funder.balance;

        vm.expectEmit(true, true, true, true, address(vesting));
        emit UsdcVesting.Cancelled(id, funder, alice, vestedNow, expectedRef);

        vm.prank(funder);
        uint256 refunded = vesting.cancel(id);

        assertEq(refunded, expectedRef, "refunded amount");
        assertEq(funder.balance, funderBefore + expectedRef, "funder balance");

        UsdcVesting.Schedule memory s = vesting.getSchedule(id);
        assertEq(s.cancelledAt, uint64(T2), "cancelledAt set");
        assertEq(s.refunded, uint128(expectedRef), "schedule.refunded");

        // totalLocked decreased by refunded amount
        assertEq(vesting.totalLocked(), vestedNow, "totalLocked = vestedNow");
    }

    // =========================================================================
    // 11. cancel before cliff — full refund
    // =========================================================================

    function test_Cancel_BeforeCliff_FullRefund() public {
        uint256 id = _createLinear(AMOUNT);
        // Warp to before cliff — nothing vested
        vm.warp(T1 + 1); // just past start but before cliff

        uint256 funderBefore = funder.balance;

        vm.prank(funder);
        uint256 refunded = vesting.cancel(id);

        assertEq(refunded, AMOUNT, "full refund before cliff");
        assertEq(funder.balance, funderBefore + AMOUNT, "funder got full refund");
        assertEq(vesting.totalLocked(), 0, "totalLocked zero");
    }

    // =========================================================================
    // 12. cancel after cliff — partial refund
    // =========================================================================

    function test_Cancel_AfterCliff_PartialRefund() public {
        uint256 id = _createLinear(AMOUNT);
        // Warp to halfway between cliff and end
        uint64 mid = T2 + (T3 - T2) / 2;
        vm.warp(mid);

        uint256 vestedNow   = AMOUNT * (mid - T1) / (T3 - T1);
        uint256 expectedRef = AMOUNT - vestedNow;

        vm.prank(funder);
        uint256 refunded = vesting.cancel(id);

        assertEq(refunded, expectedRef, "partial refund");
        assertGt(refunded, 0,           "refunded > 0");
        assertLt(refunded, AMOUNT,      "refunded < total");
    }

    // =========================================================================
    // 13. cancel between tranches — refund = unvested tranches
    // =========================================================================

    function test_Cancel_BetweenTranches_RefundIsUnvested() public {
        uint256 id = _createTranches2(600e18, 400e18);
        // Warp to after first tranche but before second
        vm.warp(T2 + 1);

        uint256 vestedNow   = 600e18;
        uint256 expectedRef = 1_000e18 - vestedNow; // 400e18

        vm.prank(funder);
        uint256 refunded = vesting.cancel(id);

        assertEq(refunded, expectedRef, "unvested tranche refunded");
    }

    // =========================================================================
    // 14. cancel — revert paths
    // =========================================================================

    function test_Cancel_RevertNotFunder() public {
        uint256 id = _createLinear(AMOUNT);
        vm.prank(bob);
        vm.expectRevert(UsdcVesting.NotFunder.selector);
        vesting.cancel(id);
    }

    function test_Cancel_RevertNotRevocable() public {
        uint256 id = _createLinearNR(AMOUNT);
        vm.prank(funder);
        vm.expectRevert(UsdcVesting.NotRevocable.selector);
        vesting.cancel(id);
    }

    function test_Cancel_RevertAlreadyCancelled() public {
        uint256 id = _createLinear(AMOUNT);
        // First cancel at the start to avoid nothing-to-reclaim
        vm.warp(T1 + 1);
        vm.prank(funder);
        vesting.cancel(id);
        // Second cancel
        vm.prank(funder);
        vm.expectRevert(UsdcVesting.AlreadyCancelled.selector);
        vesting.cancel(id);
    }

    function test_Cancel_RevertUnknownSchedule_IdZero() public {
        vm.expectRevert(UsdcVesting.UnknownSchedule.selector);
        vesting.cancel(0);
    }

    function test_Cancel_RevertUnknownSchedule_IdBeyondCount() public {
        _createLinear(AMOUNT);
        vm.prank(funder);
        vm.expectRevert(UsdcVesting.UnknownSchedule.selector);
        vesting.cancel(999);
    }

    // =========================================================================
    // 15. NothingToReclaim — cancel when fully vested
    // =========================================================================

    function test_Cancel_RevertNothingToReclaim_FullyVested() public {
        uint256 id = _createLinear(AMOUNT);
        vm.warp(T3); // fully vested
        vm.prank(funder);
        vm.expectRevert(UsdcVesting.NothingToReclaim.selector);
        vesting.cancel(id);
    }

    // =========================================================================
    // 16. After cancel: vested frozen at cancelledAt; beneficiary can still claim
    // =========================================================================

    function test_AfterCancel_VestedFrozenAtCancelTime() public {
        uint256 id = _createLinear(AMOUNT);
        uint64 cancelTime = T2 + (T3 - T2) / 3;
        vm.warp(cancelTime);

        uint256 vestedAtCancel = vesting.vestedAmount(id, uint64(cancelTime));

        vm.prank(funder);
        vesting.cancel(id);

        // Warp far into the future — vested should not increase past cancelledAt
        vm.warp(T3 + 365 days);
        assertEq(
            vesting.vestedAmount(id, uint64(block.timestamp)),
            vestedAtCancel,
            "vested frozen after cancel"
        );
    }

    function test_AfterCancel_BeneficiaryCanStillClaimVestedPortion() public {
        uint256 id = _createLinear(AMOUNT);
        uint64 cancelTime = T2 + (T3 - T2) / 2;
        vm.warp(cancelTime);

        uint256 vestedAtCancel = vesting.vestedAmount(id, uint64(cancelTime));

        vm.prank(funder);
        vesting.cancel(id);

        // Alice claims after cancel — should get exactly vestedAtCancel
        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        uint256 claimed = vesting.claim(id);

        assertEq(claimed, vestedAtCancel,             "beneficiary claims vested portion");
        assertEq(alice.balance, aliceBefore + vestedAtCancel, "alice balance correct");

        // totalLocked is now 0
        assertEq(vesting.totalLocked(), 0, "totalLocked zero after claim post-cancel");
    }

    function test_AfterCancel_PartiallyClaimedThenCancelled() public {
        uint256 id = _createLinear(AMOUNT);

        // Claim some at cliff
        vm.warp(T2);
        uint256 claimed1 = vesting.claim(id);

        // Cancel at midpoint
        uint64 cancelTime = T2 + (T3 - T2) / 2;
        vm.warp(cancelTime);

        uint256 vestedAtCancel = vesting.vestedAmount(id, uint64(cancelTime));
        uint256 claimable      = vestedAtCancel - claimed1;

        vm.prank(funder);
        vesting.cancel(id);

        // Alice claims the remaining vested-but-unclaimed portion
        if (claimable > 0) {
            uint256 aliceBefore = alice.balance;
            uint256 claimed2 = vesting.claim(id);
            assertEq(claimed2, claimable,               "remaining claimable correct");
            assertEq(alice.balance, aliceBefore + claimable, "alice balance correct");
        }

        // Nothing more to claim
        vm.expectRevert(UsdcVesting.NothingToClaim.selector);
        vesting.claim(id);
    }

    // =========================================================================
    // 17. Views never revert for unknown ids
    // =========================================================================

    function test_Views_NeverRevertForUnknownId_Zero() public view {
        // All view functions must return graceful defaults for id=0
        UsdcVesting.Schedule memory s = vesting.getSchedule(0);
        assertEq(s.total, 0, "getSchedule(0).total");

        UsdcVesting.Tranche[] memory tr = vesting.getTranches(0);
        assertEq(tr.length, 0, "getTranches(0) empty");

        assertEq(vesting.vestedAmount(0, uint64(block.timestamp)), 0, "vestedAmount(0)");
        assertEq(vesting.claimable(0), 0, "claimable(0)");
        assertEq(vesting.status(0), 0,    "status(0) = None");
    }

    function test_Views_NeverRevertForUnknownId_LargeId() public view {
        UsdcVesting.Schedule memory s = vesting.getSchedule(999);
        assertEq(s.total, 0, "getSchedule(999).total");

        UsdcVesting.Tranche[] memory tr = vesting.getTranches(999);
        assertEq(tr.length, 0, "getTranches(999) empty");

        assertEq(vesting.vestedAmount(999, uint64(block.timestamp)), 0, "vestedAmount(999)");
        assertEq(vesting.claimable(999), 0, "claimable(999)");
        assertEq(vesting.status(999), 0,    "status(999) = None");
    }

    // =========================================================================
    // 18. status() — all states
    // =========================================================================

    function test_Status_None() public view {
        assertEq(vesting.status(0),   0, "id=0 = None");
        assertEq(vesting.status(999), 0, "id=999 = None");
    }

    function test_Status_Active() public {
        uint256 id = _createLinear(AMOUNT);
        assertEq(vesting.status(id), 1, "newly created = Active");
    }

    function test_Status_Completed() public {
        uint256 id = _createLinear(AMOUNT);
        vm.warp(T3);
        vesting.claim(id); // claim all
        assertEq(vesting.status(id), 2, "fully claimed = Completed");
    }

    function test_Status_Cancelled() public {
        // Cancel after cliff so vestedNow > 0. This means refunded < total,
        // so claimed + refunded < total and the Completed branch is NOT taken.
        // status() returns 3 (Cancelled) only when funds are still outstanding.
        uint256 id = _createLinear(AMOUNT);
        vm.warp(T2 + 1 days); // past cliff, some vested => refunded < total
        vm.prank(funder);
        vesting.cancel(id);
        // claimed=0, refunded<total => Cancelled (status 3)
        assertEq(vesting.status(id), 3, "cancelled with outstanding vested portion = Cancelled");
    }

    function test_Status_Cancelled_BeforeCliff_IsCompleted() public {
        // Cancelling before cliff means vestedNow=0, so refunded=total.
        // claimed(0) + refunded(total) == total => status() returns 2 (Completed),
        // NOT 3, because all funds are fully accounted for.
        uint256 id = _createLinear(AMOUNT);
        vm.warp(T1 + 1); // before cliff, nothing vested
        vm.prank(funder);
        vesting.cancel(id);
        // refunded == total => Completed (status 2), not Cancelled (3)
        assertEq(vesting.status(id), 2, "full-refund cancel = Completed (all funds settled)");
    }

    function test_Status_Completed_AfterCancelAndClaim() public {
        uint256 id = _createLinear(AMOUNT);
        vm.warp(T2); // at cliff, some vested

        uint256 vestedNow = vesting.vestedAmount(id, uint64(T2));
        vm.prank(funder);
        vesting.cancel(id); // refund unvested

        // Claim the vested portion
        vesting.claim(id);

        // claimed + refunded == total = Completed
        assertEq(vesting.status(id), 2, "cancelled + fully claimed = Completed");
    }

    // =========================================================================
    // 19. TransferFailed on claim — rejecting beneficiary
    // =========================================================================

    function test_TransferFailed_OnClaim_RejectingBeneficiary() public {
        Rejector rejector = new Rejector();

        vm.prank(funder);
        uint256 id = vesting.createLinear{value: AMOUNT}(
            address(rejector), T1, T2, T3, true
        );

        vm.warp(T3);
        vm.expectRevert(UsdcVesting.TransferFailed.selector);
        vesting.claim(id);
    }

    // =========================================================================
    // Blocklist / non-receiving beneficiary: documented limitation
    // - claim() reverts with TransferFailed (vested portion stays locked)
    // - funder can still cancel a revocable schedule and receives only the
    //   UNVESTED portion; the vested-but-undeliverable portion remains locked
    // =========================================================================

    function test_BlocklistedBeneficiary_ClaimReverts_CancelReturnsUnvested() public {
        Rejector rejBeneficiary = new Rejector();

        vm.prank(funder);
        uint256 id = vesting.createLinear{value: AMOUNT}(
            address(rejBeneficiary), T1, T2, T3, true
        );

        // Warp past cliff — some funds are now vested
        vm.warp(T2 + (T3 - T2) / 2);
        uint256 vestedNow = vesting.vestedAmount(id, uint64(block.timestamp));
        assertGt(vestedNow, 0, "some funds must be vested");

        // claim() reverts because beneficiary rejects native transfers
        vm.expectRevert(UsdcVesting.TransferFailed.selector);
        vesting.claim(id);

        // Vested amount remains locked: totalLocked unchanged
        assertEq(vesting.totalLocked(), AMOUNT, "totalLocked unchanged after failed claim");

        // Funder cancels — gets back only the UNVESTED portion
        uint256 funderBefore   = funder.balance;
        uint256 expectedRefund = AMOUNT - vestedNow;

        vm.prank(funder);
        uint256 refunded = vesting.cancel(id);

        assertEq(refunded,        expectedRefund,              "funder gets unvested only");
        assertEq(funder.balance,  funderBefore + expectedRefund, "funder balance correct");

        // Vested-but-undeliverable portion remains locked in the contract
        assertEq(vesting.totalLocked(), vestedNow, "vestedNow still locked");

        // Further claim still reverts (beneficiary is still a Rejector)
        vm.expectRevert(UsdcVesting.TransferFailed.selector);
        vesting.claim(id);
    }

    // =========================================================================
    // 20. TransferFailed on cancel — rejecting funder
    // =========================================================================

    function test_TransferFailed_OnCancel_RejectingFunder() public {
        Rejector rejector = new Rejector();
        vm.deal(address(rejector), AMOUNT);

        // The rejector must call createLinear itself to be the funder
        vm.prank(address(rejector));
        // We need rejector to have a way to call the vesting contract.
        // Since Rejector's receive rejects, but it can still make external calls.
        // Use a wrapper approach: fund rejector and call from it.
        uint256 id = vesting.createLinear{value: AMOUNT}(
            alice, T1, T2, T3, true
        );

        vm.warp(T1 + 1); // before cliff, so refund > 0

        vm.prank(address(rejector));
        vm.expectRevert(UsdcVesting.TransferFailed.selector);
        vesting.cancel(id);
    }

    // =========================================================================
    // Fuzz: createLinear with random valid params
    // =========================================================================

    function testFuzz_CreateLinear_ValidParams(
        uint128 value,
        uint64  startOffset,
        uint64  cliffOffset,
        uint64  durationOffset
    ) public {
        // Bound to reasonable ranges
        value        = uint128(bound(value,        1e6, type(uint128).max));
        startOffset  = uint64(bound(startOffset,   1,   365 days));
        cliffOffset  = uint64(bound(cliffOffset,   0,   365 days));
        durationOffset = uint64(bound(durationOffset, 1, vesting.MAX_DURATION()));

        uint64 start = uint64(block.timestamp) + startOffset;
        uint64 cliff = start + cliffOffset;
        uint64 end   = start + durationOffset;
        // Ensure cliff <= end
        if (cliff > end) cliff = end;
        // Ensure end > block.timestamp (already since start > now and end >= start)

        vm.deal(funder, uint256(value));
        vm.prank(funder);
        uint256 id = vesting.createLinear{value: value}(alice, start, cliff, end, true);

        assertEq(id, vesting.scheduleCount(), "id == scheduleCount");
        UsdcVesting.Schedule memory s = vesting.getSchedule(id);
        assertEq(s.total, value, "total == value");
        assertTrue(vesting.totalLocked() >= value, "totalLocked >= value");
    }

    // =========================================================================
    // Fuzz: linear vested math — random (total, start, cliff, end, t)
    // =========================================================================

    function testFuzz_LinearVestedMath(
        uint128 total,
        uint64  startOffset,
        uint64  cliffExtraOffset,
        uint64  durationOffset,
        uint64  tOffset
    ) public {
        total           = uint128(bound(total,           1e6, type(uint128).max));
        startOffset     = uint64(bound(startOffset,      1,   30 days));
        cliffExtraOffset = uint64(bound(cliffExtraOffset, 0,  30 days));
        durationOffset  = uint64(bound(durationOffset,    1,  3650 days));

        uint64 now_   = uint64(block.timestamp);
        uint64 start  = now_ + startOffset;
        uint64 cliff  = start + cliffExtraOffset;
        uint64 end    = start + durationOffset;
        if (cliff > end) cliff = end;

        vm.deal(funder, uint256(total));
        vm.prank(funder);
        uint256 id = vesting.createLinear{value: total}(alice, start, cliff, end, true);

        // t anywhere in [0, end + 1 year]
        uint64 t = uint64(bound(tOffset, 0, end + uint64(365 days)));

        uint256 vested = vesting.vestedAmount(id, t);

        // Properties:
        assertGe(vested, 0,             "vested >= 0");
        assertLe(vested, total,         "vested <= total");
        if (t < cliff) {
            assertEq(vested, 0,         "before cliff: vested == 0");
        }
        if (t >= end) {
            assertEq(vested, total,     "at/after end: fully vested");
        }
        if (t >= cliff && t < end) {
            uint256 exp = uint256(total) * (t - start) / (end - start);
            assertEq(vested, exp,       "linear interpolation correct");
        }
    }

    // =========================================================================
    // Fuzz: tranche amounts summing correctly
    // =========================================================================

    function testFuzz_TrancheSumMatchesValue(uint8 n, uint128 baseAmount) public {
        n          = uint8(bound(n,          1, 10));
        baseAmount = uint128(bound(baseAmount, 1e6, 1e22));

        uint64[]  memory times   = new uint64[](n);
        uint128[] memory amounts = new uint128[](n);

        uint256 total = 0;
        uint64  timeBase = uint64(block.timestamp + 1 days);
        for (uint256 i = 0; i < n; i++) {
            times[i]   = timeBase + uint64(i + 1) * 1 days;
            amounts[i] = baseAmount;
            total     += baseAmount;
        }
        // Ensure total fits uint128 and doesn't overflow
        if (total > type(uint128).max) return; // skip overflow edge case

        vm.deal(funder, total);
        vm.prank(funder);
        uint256 id = vesting.createTranches{value: total}(alice, times, amounts, false);

        // getTranches returns all tranches, sum their amounts
        UsdcVesting.Tranche[] memory tr = vesting.getTranches(id);
        uint256 sum = 0;
        for (uint256 i = 0; i < tr.length; i++) {
            sum += tr[i].amount;
        }
        assertEq(sum, total, "tranche amounts sum == total");
    }

    // =========================================================================
    // Fuzz: claim amount never exceeds vested
    // =========================================================================

    function testFuzz_ClaimNeverExceedsVested(uint64 warpOffset) public {
        uint256 id = _createLinear(AMOUNT);

        // Warp to some time between now and end+1yr
        uint64 t = uint64(bound(warpOffset, T0, T3 + 365 days));
        vm.warp(t);

        uint256 vestedNow = vesting.vestedAmount(id, uint64(t));

        if (vestedNow == 0) {
            vm.expectRevert(UsdcVesting.NothingToClaim.selector);
            vesting.claim(id);
        } else {
            uint256 claimed = vesting.claim(id);
            assertLe(claimed, AMOUNT,    "claimed <= total");
            assertLe(claimed, vestedNow, "claimed <= vested");
        }
    }
}

// =============================================================================
// Invariant test suite
// =============================================================================

/// @dev Handler contract for stateful invariant testing.
///      3 funders × 3 beneficiaries create linear and tranche schedules,
///      claim, cancel, and warp time.
contract VestingHandler is Test {
    UsdcVesting public vesting;

    address[3] public funders;
    address[3] public beneficiaries;

    // Track all schedule ids created through the handler
    uint256[] public scheduleIds;

    // Track which schedules have been cancelled (to avoid double-cancel)
    mapping(uint256 => bool) public cancelled;
    // Track how much each schedule has had refunded (for invariant checks)
    mapping(uint256 => uint256) public refundedBySchedule;

    uint256 public constant MAX_DURATION = 3650 days;

    constructor(UsdcVesting _vesting) {
        vesting = _vesting;

        funders[0]       = makeAddr("handler_funder0");
        funders[1]       = makeAddr("handler_funder1");
        funders[2]       = makeAddr("handler_funder2");
        beneficiaries[0] = makeAddr("handler_bene0");
        beneficiaries[1] = makeAddr("handler_bene1");
        beneficiaries[2] = makeAddr("handler_bene2");

        // Give each funder plenty of native balance
        for (uint256 i = 0; i < 3; i++) {
            vm.deal(funders[i], 1_000_000e18);
        }
    }

    // ── actions ──────────────────────────────────────────────────────────────

    function createLinear(
        uint8  funderIdx,
        uint8  beneIdx,
        uint128 amount,
        uint64  startOffset,
        uint64  cliffExtraOffset,
        uint64  durationOffset
    ) external {
        funderIdx = uint8(bound(funderIdx, 0, 2));
        beneIdx   = uint8(bound(beneIdx,   0, 2));
        amount    = uint128(bound(amount,  1e6, 1_000e18));

        address fnd = funders[funderIdx];
        address ben = beneficiaries[beneIdx];
        if (fnd == ben) return; // would be SelfSchedule

        startOffset      = uint64(bound(startOffset,      1,  30 days));
        cliffExtraOffset = uint64(bound(cliffExtraOffset,  0,  30 days));
        durationOffset   = uint64(bound(durationOffset,    1,  MAX_DURATION));

        uint64 start = uint64(block.timestamp) + startOffset;
        uint64 cliff = start + cliffExtraOffset;
        uint64 end   = start + durationOffset;
        if (cliff > end) cliff = end;

        // Ensure funder has enough balance
        if (address(fnd).balance < amount) vm.deal(fnd, amount + 1 ether);

        vm.prank(fnd);
        try vesting.createLinear{value: amount}(ben, start, cliff, end, true) returns (uint256 id) {
            scheduleIds.push(id);
        } catch {}
    }

    function createTranches(
        uint8   funderIdx,
        uint8   beneIdx,
        uint128 amountPerTranche,
        uint8   n
    ) external {
        funderIdx       = uint8(bound(funderIdx, 0, 2));
        beneIdx         = uint8(bound(beneIdx,   0, 2));
        n               = uint8(bound(n,         1, 5));
        amountPerTranche = uint128(bound(amountPerTranche, 1e6, 100e18));

        address fnd = funders[funderIdx];
        address ben = beneficiaries[beneIdx];
        if (fnd == ben) return;

        uint256 total = uint256(amountPerTranche) * n;
        if (total > type(uint128).max) return;

        uint64[]  memory times   = new uint64[](n);
        uint128[] memory amounts = new uint128[](n);
        uint64 timeBase = uint64(block.timestamp + 1 days);
        for (uint256 i = 0; i < n; i++) {
            times[i]   = timeBase + uint64(i + 1) * 1 days;
            amounts[i] = amountPerTranche;
        }

        if (address(fnd).balance < total) vm.deal(fnd, total + 1 ether);

        vm.prank(fnd);
        try vesting.createTranches{value: total}(ben, times, amounts, true) returns (uint256 id) {
            scheduleIds.push(id);
        } catch {}
    }

    function claim(uint256 idSeed) external {
        if (scheduleIds.length == 0) return;
        uint256 idx = idSeed % scheduleIds.length;
        uint256 id  = scheduleIds[idx];
        try vesting.claim(id) {} catch {}
    }

    function cancel(uint256 idSeed) external {
        if (scheduleIds.length == 0) return;
        uint256 idx = idSeed % scheduleIds.length;
        uint256 id  = scheduleIds[idx];
        if (cancelled[id]) return;

        UsdcVesting.Schedule memory s = vesting.getSchedule(id);
        if (!s.revocable || s.cancelledAt != 0) return;

        // Ensure funder has enough to receive refund (it always does since it's an EOA)
        vm.prank(s.funder);
        try vesting.cancel(id) returns (uint256 refunded) {
            cancelled[id] = true;
            refundedBySchedule[id] = refunded;
        } catch {}
    }

    function warpTime(uint64 seconds_) external {
        seconds_ = uint64(bound(seconds_, 1, 30 days));
        vm.warp(block.timestamp + seconds_);
    }

    // ── helper ───────────────────────────────────────────────────────────────

    function allScheduleIds() external view returns (uint256[] memory) {
        return scheduleIds;
    }
}

contract UsdcVestingInvariantTest is StdInvariant, Test {
    UsdcVesting    internal vesting;
    VestingHandler internal handler;

    function setUp() public {
        vesting = new UsdcVesting();
        handler = new VestingHandler(vesting);

        // Target the handler — invariant engine will call its public functions
        targetContract(address(handler));

        // Exclude the vesting contract itself from direct invariant calls
        excludeContract(address(vesting));
    }

    // ── Invariant 1: contract balance == totalLocked ────────────────────────

    function invariant_BalanceEqualsTotalLocked() public view {
        assertEq(
            address(vesting).balance,
            vesting.totalLocked(),
            "INV1: balance != totalLocked"
        );
    }

    // ── Invariant 2: totalLocked == sum(total - claimed - refunded) ──────────

    function invariant_TotalLockedMatchesScheduleSums() public view {
        uint256 count = vesting.scheduleCount();
        uint256 sum   = 0;
        for (uint256 id = 1; id <= count; id++) {
            UsdcVesting.Schedule memory s = vesting.getSchedule(id);
            sum += uint256(s.total) - uint256(s.claimed) - uint256(s.refunded);
        }
        assertEq(
            vesting.totalLocked(),
            sum,
            "INV2: totalLocked != sum(total-claimed-refunded)"
        );
    }

    // ── Invariant 3: claimed <= vestedAmount(now) <= total ───────────────────

    function invariant_ClaimedLeVestedLeTotal() public view {
        uint256 count = vesting.scheduleCount();
        for (uint256 id = 1; id <= count; id++) {
            UsdcVesting.Schedule memory s = vesting.getSchedule(id);
            uint256 vestedNow = vesting.vestedAmount(id, uint64(block.timestamp));
            assertLe(
                uint256(s.claimed),
                vestedNow,
                "INV3: claimed > vested"
            );
            assertLe(
                vestedNow,
                uint256(s.total),
                "INV3: vested > total"
            );
        }
    }

    // ── Invariant 4: After cancel, vestedAmount(future) == vestedAmount(cancelledAt) ─

    function invariant_CancelledVestingFrozen() public view {
        uint256 count = vesting.scheduleCount();
        for (uint256 id = 1; id <= count; id++) {
            UsdcVesting.Schedule memory s = vesting.getSchedule(id);
            if (s.cancelledAt == 0) continue;

            uint256 vestedAtCancel = vesting.vestedAmount(id, s.cancelledAt);
            uint256 vestedNow      = vesting.vestedAmount(id, uint64(block.timestamp));
            assertEq(
                vestedNow,
                vestedAtCancel,
                "INV4: vested increased after cancel"
            );
        }
    }

    // ── Invariant 5: After cancel, refunded == total - vestedAmount(cancelledAt) ─

    function invariant_RefundedEqualsUnvestedAtCancel() public view {
        uint256 count = vesting.scheduleCount();
        for (uint256 id = 1; id <= count; id++) {
            UsdcVesting.Schedule memory s = vesting.getSchedule(id);
            if (s.cancelledAt == 0) continue;

            uint256 vestedAtCancel = vesting.vestedAmount(id, s.cancelledAt);
            uint256 expectedRefund = uint256(s.total) - vestedAtCancel;
            assertEq(
                uint256(s.refunded),
                expectedRefund,
                "INV5: refunded != total - vestedAtCancel"
            );
        }
    }
}

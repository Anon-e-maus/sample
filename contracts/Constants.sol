
pragma solidity ^0.5.17;
pragma experimental ABIEncoderV2;

import "./external/Decimal.sol";

library Constants {
    /* Chain */
    uint256 private constant CHAIN_ID = 1; // Mainnet

    /* Oracle */
    address private constant sXAU = address(0x261EfCdD24CeA98652B9700800a13DfBca4103fF);
    uint256 private constant ORACLE_RESERVE_MINIMUM = 1e18;

    /* Bonding */
    uint256 private constant INITIAL_STAKE_MULTIPLE = 1e6; // 100 TKN -> 100M TKNS

    /* Pool */
    uint256 private constant POOL_EXIT_LOCKUP_EPOCHS = 8; // 2 days

    address private constant DAO_ADDRESS = address(0x0);
    address private constant GOLD_ADDRESS = address(0x0);

    function getSXAUAddress() internal pure returns (address) {
        return sXAU;
    }

    function getOracleReserveMinimum() internal pure returns (uint256) {
        return ORACLE_RESERVE_MINIMUM;
    }

    function getInitialStakeMultiple() internal pure returns (uint256) {
        return INITIAL_STAKE_MULTIPLE;
    }

    function getPoolExitLockupEpochs() internal pure returns (uint256) {
        return POOL_EXIT_LOCKUP_EPOCHS;
    }

    function getChainId() internal pure returns (uint256) {
        return CHAIN_ID;
    }

    function getTreasuryAddress() internal pure returns (address) {
        return address(0x0);
    }

    function getDaoAddress() internal pure returns (address) {
        return DAO_ADDRESS;
    }

    function getGoldAddress() internal pure returns (address) {
        return GOLD_ADDRESS;
    }

    function getOraclePoolAddress() internal pure returns (address) {
        return address(0x0);
    }
}


pragma solidity ^0.5.17;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20Detailed.sol";

contract MockToken is ERC20Detailed, ERC20Burnable {
    constructor(string memory name, string memory symbol, uint8 decimals)
    ERC20Detailed(name, symbol, decimals)
    public
    { }

    function mint(address account, uint256 amount) external returns (bool) {
        _mint(account, amount);
        return true;
    }
}

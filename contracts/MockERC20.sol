// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockERC20
 * @dev A simple ERC20 token implementation for testing purposes
 */
contract MockERC20 is ERC20 {
    /**
     * @dev Constructor that gives the msg.sender all of the initial supply.
     * @param name_ The name of the token
     * @param symbol_ The symbol of the token
     * @param initialSupply_ The initial supply of tokens
     */
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 initialSupply_
    ) ERC20(name_, symbol_) {
        _mint(msg.sender, initialSupply_);
    }
} 
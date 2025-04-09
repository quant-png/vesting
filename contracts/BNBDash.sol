// SPDX-License-Identifier: MIT

/**
 *  PPPPP  IIIII ZZZZZ ZZZZZ  AAAAA 
 *  P    P   I       Z     Z A     A
 *  P    P   I      Z     Z  A     A
 *  PPPPP    I     Z     Z   AAAAAAA
 *  P        I    Z     Z    A     A
 *  P        I   Z     Z     A     A
 *  P      IIIII ZZZZZ ZZZZZ A     A
 *                   
 *         _....._
 *     _.:`.--|--.`:._
 *   .: .'\o/`---'\o/'. '.
 *  // '.  |    |  .  .' \\
 * //'._o'. \   / .'o_.'\\
 * || o '-.'.  .'.-' o ||
 * ||--o--o-->|<--o--o--||
 * \\ o _.-'/   \'-._o //
 *  \\.'   /  o  \   './
 *   '. o.'-----'.o .'
 *      `-:_____:-'
 */

pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract BNBDash is ERC20, Ownable {
    constructor() ERC20("BNBDash", "PIZZA") Ownable(msg.sender) {
        _mint(msg.sender, 1_000_000_000 * 10 ** decimals());
    }
}
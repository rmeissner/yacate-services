pragma solidity >=0.4.21 <0.6.0;

import "@gnosis.pm/util-contracts/contracts/GnosisStandardToken.sol";

contract TestCompound is GnosisStandardToken {
    address public underlying;

    constructor(address _underlying) public {
        underlying = _underlying;
    }

    function mint(uint256 amount) external returns (uint256) {
        require(Token(underlying).transferFrom(msg.sender, address(this), amount), "transferFrom failed");
        balances[msg.sender] = balances[msg.sender].add(amount);
        return amount;
    }
}
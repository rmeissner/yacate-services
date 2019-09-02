pragma solidity >=0.4.21 <0.6.0;
pragma experimental ABIEncoderV2;

import "@gnosis.pm/safe-contracts/contracts/base/Module.sol";
import "@gnosis.pm/safe-contracts/contracts/external/SafeMath.sol";
import "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";
import "@gnosis.pm/util-contracts/contracts/Token.sol";

contract TopUpModule is Module {

    using SafeMath for uint256;

    struct TopUpRule {
        address sourceToken; // Token that will be used up to ming new tokens
        address mintToken; // Token that can mint new tokens
        uint256 minTransferAmount;
        uint256 maxTriggerReward;
        uint256 noTransferAmount; // Amount that should not be used for topup
    }

    mapping(uint256 => TopUpRule) rules;
    uint256 rulesCount;

    function setup(TopUpRule[] calldata _rules) external {
        setManager();

        for (uint256 i = 0; i < _rules.length; i++) {
            internalAddRule(i, _rules[i]);
            rulesCount = _rules.length;
        }
    }

    function listRules() external view returns (TopUpRule[] memory _rules) {
        _rules = new TopUpRule[](rulesCount);
        for (uint256 i = 0; i < rulesCount; i++) {
            _rules[i] = rules[i];
        }
    }

    function addRule(TopUpRule calldata _rule) external authorized() {
        internalAddRule(rulesCount, _rule);
        rulesCount++;
    }

    function internalAddRule(uint256 index, TopUpRule memory rule) internal {
        require(rule.mintToken != address(0), "rule.mintToken != address(0)");
        rules[index] = rule;
    }

    function removeRule(uint256 _index) external authorized() {
        delete rules[_index];
        rules[_index] = rules[rulesCount];
        rulesCount--;
    }

    function executeTopUp(uint256 _index, uint256 _requestedReward) public {
        TopUpRule memory rule = rules[_index];
        require(rule.maxTriggerReward >= _requestedReward, "rule.maxTriggerReward >= _requestedReward");
        require(rule.mintToken != address(0), "rule.mintToken != address(0)");

        uint256 balance = Token(rule.sourceToken).balanceOf(address(manager));
        require(balance >= rule.minTransferAmount, "balance >= rule.minTransferAmount");

        uint256 amount = balance.sub(rule.noTransferAmount).sub(_requestedReward);
        bytes memory approveData = abi.encodeWithSignature("approve(address,uint256)", rule.mintToken, amount);
        require(manager.execTransactionFromModule(rule.sourceToken, 0, approveData, Enum.Operation.Call), "Could not execute token approval");

        bytes memory mintData = abi.encodeWithSignature("mint(uint256)", amount);
        require(manager.execTransactionFromModule(rule.mintToken, 0, mintData, Enum.Operation.Call), "Could not execute token minting");

        // solium-disable-next-line security/no-tx-origin
        bytes memory transferData = abi.encodeWithSignature("transfer(address,uint256)", tx.origin, _requestedReward);
        require(manager.execTransactionFromModule(rule.sourceToken, 0, transferData, Enum.Operation.Call), "Could not execute token transfer");
    }


}
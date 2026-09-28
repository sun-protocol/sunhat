# pragma version 0.4.3

stored_value: public(uint256)


@deploy
def __init__(initial_value: uint256):
    self.stored_value = initial_value


@external
def set_value(new_value: uint256):
    self.stored_value = new_value

local harpoon_keys = {
	add_file = "<leader>zf",
	toggle_quick_menu = "<leader>zm",
	mark_one = "<leader>m1",
	mark_two = "<leader>m2",
	mark_three = "<leader>m3",
	mark_four = "<leader>m4",
}

local used_keys = {}

for _, v in pairs(harpoon_keys) do
	table.insert(used_keys, v)
end

return {
	"theprimeagen/harpoon",
	keys = used_keys,
	config = function()
		local mark = require("harpoon.mark")
		local ui = require("harpoon.ui")

		vim.keymap.set("n", "<leader>zf", mark.add_file)
		vim.keymap.set("n", "<leader>zm", ui.toggle_quick_menu)

		vim.keymap.set("n", "<leader>m1", function()
			ui.nav_file(1)
		end)

		vim.keymap.set("n", "<leader>m2", function()
			ui.nav_file(2)
		end)

		vim.keymap.set("n", "<leader>m3", function()
			ui.nav_file(3)
		end)

		vim.keymap.set("n", "<leader>m4", function()
			ui.nav_file(4)
		end)
	end,
}

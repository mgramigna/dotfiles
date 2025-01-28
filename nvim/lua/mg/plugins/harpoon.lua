return {
	"theprimeagen/harpoon",
	branch = "harpoon2",
	config = function()
		local harpoon = require("harpoon")

		harpoon:setup()

		vim.keymap.set("n", "<leader>zf", function()
			harpoon:list():add()
		end)

		vim.keymap.set("n", "<leader>zm", function()
			harpoon.ui:toggle_quick_menu(harpoon:list())
		end)

		vim.keymap.set("n", "<leader>m1", function()
			harpoon:list():select(1)
		end)
		vim.keymap.set("n", "<leader>m2", function()
			harpoon:list():select(2)
		end)
		vim.keymap.set("n", "<leader>m3", function()
			harpoon:list():select(3)
		end)
		vim.keymap.set("n", "<leader>m4", function()
			harpoon:list():select(4)
		end)
		vim.keymap.set("n", "<leader>m5", function()
			harpoon:list():select(5)
		end)
	end,
}

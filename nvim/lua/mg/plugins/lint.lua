local function current_dir_contains(substring)
	local cwd = vim.fn.getcwd()
	return string.find(cwd, substring, 1, true) ~= nil
end

local function post_setup_eslint_d()
	vim.keymap.set(
		"n",
		"<leader>ef",
		"mF:%!eslint_d --stdin --fix-to-stdout --stdin-filename %<CR>`F",
		{ noremap = true, silent = true }
	)

	vim.keymap.set("n", "<leader>ed", function()
		local diagnostics = vim.diagnostic.get(0, {
			severity = vim.diagnostic.severity.ERROR,
			-- line number need to be 0 indexed in this api
			lnum = vim.api.nvim_win_get_cursor(0)[1] - 1,
		})

		local choices = {}
		for k, v in pairs(diagnostics) do
			if v.source == "eslint_d" then
				choices[k] = v.code
			end
		end

		if #choices > 0 then
			vim.ui.select(choices, {
				prompt = "Disable Eslint Rule (line)",
				format_item = function(item)
					return "// eslint-disable-next-line " .. item
				end,
			}, function(choice)
				local cursor_pos = vim.api.nvim_win_get_cursor(0)
				local current_line = cursor_pos[1]

				local text_to_insert = "// eslint-disable-next-line " .. choice
				vim.api.nvim_buf_set_lines(0, current_line - 1, current_line - 1, false, { text_to_insert })
				vim.api.nvim_win_set_cursor(0, { current_line + 1, cursor_pos[2] })
			end)
		end
	end, { noremap = true, silent = true })
end

return {
	"mfussenegger/nvim-lint",
	config = function()
		vim.env.ESLINT_D_PPID = vim.fn.getpid()
		if current_dir_contains("infrastructure") then
			vim.env.ESLINT_D_ROOT = "/Users/matthew.gramigna/code/infrastructure/common/temp/"
		end

		require("lint").linters_by_ft = {
			python = { "mypy" },
			typescript = { "eslint_d" },
			javascript = { "eslint_d" },
			typescriptreact = { "eslint_d" },
			javascriptreact = { "eslint_d" },
		}

		vim.api.nvim_create_autocmd({ "BufWritePost" }, {
			callback = function()
				require("lint").try_lint()
			end,
		})

		post_setup_eslint_d()
	end,
}
